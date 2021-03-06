import {
    HostPacketType,
    UserInfo,
    ClientPacketType,
    Versions,
    PingInfo,
    PeerOptions,
    Host,
    Client,
} from "../src";
import { libraryVersion } from "../generated/version";
import { resetHistory } from "./packet-history";

export interface MockUser {
    id: string;
    name: string;
}

export const enum MockMessageType {
    MOCK_MESSAGE = "mock message",
}

export interface MockPayload {
    test: string;
}

export function mockPeerOptions(override: Partial<PeerOptions<MockUser>> = {}): PeerOptions<MockUser> {
    return {
        timeout: 0.05,
        applicationProtocolVersion: "1.0.0",
        welcomeDelay: 0.001,
        ...override,
    };
}

export function mockHistoryPacket(
    from: string,
    to: string,
    packetType: ClientPacketType | HostPacketType,
    data: any,
): any {
    return { from, to, data: { packetType, ...data } };
}

export function mockUserInfo(override: Partial<UserInfo<MockUser>> & { user: MockUser }): UserInfo<MockUser> {
    return {
        lastPingDate: expect.any(Number),
        roundTripTime: undefined,
        disconnected: false,
        ...override,
    };
}

export function mockVersion(override?: Partial<Versions>): Versions {
    return {
        application: "1.0.0",
        p2pNetwork: libraryVersion,
        ...override,
    };
}

export function mockUserList(...users: MockUser[]): MockUser[] {
    return users.sort((a, b) => a.id.localeCompare(b.id));
}

export function mockUserInfoList(...users: UserInfo<MockUser>[]): UserInfo<MockUser>[] {
    return users.sort((a, b) => a.user.id.localeCompare(b.user.id));
}

export function mockPingInfoList(...infos: (PingInfo & { userId: string })[]): (PingInfo & { userId: string })[] {
    return infos.sort((a, b) => a.userId.localeCompare(b.userId));
}

export interface ScenarioSimple {
    host: Host<MockUser, MockMessageType>;
    client: Client<MockUser, MockMessageType>;
    hostPeerId: string;
    clientPeerId: string;
}

export interface ScenarioFourPeers {
    host: Host<MockUser, MockMessageType>;
    clients: Client<MockUser, MockMessageType>[];
    hostPeerId: string;
    clientPeerIds: string[];
}

export async function scenarioFourPeers(
    open = true,
    hostOptions?: Partial<PeerOptions<MockUser>>,
    clientOptions?: Partial<PeerOptions<MockUser>>,
): Promise<ScenarioFourPeers> {
    resetHistory();
    const host = new Host<MockUser, MockMessageType>({
        ...mockPeerOptions(),
        ...hostOptions,
    });
    const clients = Array.from({ length: 3 }).map(
        () =>
            new Client<MockUser, MockMessageType>({
                ...mockPeerOptions(),
                ...clientOptions,
            }),
    );
    if (!open) {
        return { host, clients, hostPeerId: "", clientPeerIds: [] };
    }
    const hostOpenResult = await host.open({ name: "Mr. Host" });
    const hostPeerId = hostOpenResult.peerId;
    const clientPeerIds = [];
    let index = 0;
    for (const client of clients) {
        const clientOpenResult = await client.open(hostPeerId, { name: `Mr. Client #${index}` });
        clientPeerIds.push(clientOpenResult.peerId);
        index++;
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return { host, clients, hostPeerId, clientPeerIds };
}

export async function scenarioSimple(
    open = true,
    hostOptions?: Partial<PeerOptions<MockUser>>,
    clientOptions?: Partial<PeerOptions<MockUser>>,
): Promise<ScenarioSimple> {
    resetHistory();
    const host = new Host<MockUser, MockMessageType>({
        ...mockPeerOptions(),
        ...hostOptions,
    });
    const client = new Client<MockUser, MockMessageType>({
        ...mockPeerOptions(),
        ...clientOptions,
    });
    if (!open) {
        return { host, client, hostPeerId: "", clientPeerId: "" };
    }
    const hostOpenResult = await host.open({ name: "Mr. Host" });
    const hostPeerId = hostOpenResult.peerId;
    const clientOpenResult = await client.open(hostPeerId, { name: "Mr. Client" });
    const clientPeerId = clientOpenResult.peerId;
    await new Promise((resolve) => setTimeout(resolve, 10));
    return { host, client, clientPeerId, hostPeerId };
}
