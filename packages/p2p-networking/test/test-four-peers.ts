jest.mock("peerjs");
import { Host, Client, ClientPacketType, HostPacketType, MessageFactory, SentMessageHandle, PingInfo } from "../src";
import { resetHistory, getHistory } from "./packet-history";
import { libraryVersion } from "../generated/version";

interface MockUser {
    id: string;
    name: string;
}

const enum MockMessageType {
    MOCK_MESSAGE = "mock message",
}

interface MockPayload {
    test: string;
}

describe("Four peers", () => {
    let host: Host<MockUser, MockMessageType>;
    let clients: Client<MockUser, MockMessageType>[];
    let hostPeerId: string;
    let clientPeerIds: string[];

    beforeEach(async () => {
        resetHistory();
        host = new Host({ timeout: 0.1, applicationProtocolVersion: "1.0.0", user: { name: "Mr. Host" } });
        clients = Array.from({ length: 3 }).map(
            (_, index) =>
                new Client({
                    timeout: 0.1,
                    applicationProtocolVersion: "1.0.0",
                    user: { name: `Mr. Client #${index}` },
                }),
        );
        const hostOpenResult = await host.open();
        hostPeerId = hostOpenResult.peerId;
        clientPeerIds = [];
        await Promise.all(
            clients.map(async (client) => {
                const clientOpenResult = await client.open(hostPeerId);
                clientPeerIds.push(clientOpenResult.peerId);
                await new Promise((resolve) => setTimeout(resolve, 10));
            }),
        );
    });

    it("has sent the expected messages", () => {
        expect(getHistory()).toEqual([
            {
                from: clientPeerIds[0],
                to: hostPeerId,
                data: {
                    packetType: ClientPacketType.HELLO,
                    versions: {
                        application: "1.0.0",
                        p2pNetwork: libraryVersion,
                    },
                    user: clients[0].user,
                },
            },
            {
                from: clientPeerIds[1],
                to: hostPeerId,
                data: {
                    packetType: ClientPacketType.HELLO,
                    versions: {
                        application: "1.0.0",
                        p2pNetwork: libraryVersion,
                    },
                    user: clients[1].user,
                },
            },
            {
                from: clientPeerIds[2],
                to: hostPeerId,
                data: {
                    packetType: ClientPacketType.HELLO,
                    versions: {
                        application: "1.0.0",
                        p2pNetwork: libraryVersion,
                    },
                    user: clients[2].user,
                },
            },
            {
                from: hostPeerId,
                to: clientPeerIds[0],
                data: {
                    packetType: HostPacketType.WELCOME,
                    users: [
                        {
                            lastPingDate: expect.any(Number),
                            roundTripTime: undefined,
                            user: host.user,
                        },
                    ].sort((a, b) => a.user.id.localeCompare(b.user.id)),
                },
            },
            {
                from: hostPeerId,
                to: clientPeerIds[0],
                data: {
                    packetType: HostPacketType.USER_CONNECTED,
                    user: clients[0].user,
                },
            },
            {
                from: hostPeerId,
                to: clientPeerIds[1],
                data: {
                    packetType: HostPacketType.WELCOME,
                    users: [
                        {
                            lastPingDate: expect.any(Number),
                            roundTripTime: undefined,
                            user: host.user,
                        },
                        {
                            lastPingDate: expect.any(Number),
                            roundTripTime: undefined,
                            user: clients[0].user,
                        },
                    ].sort((a, b) => a.user.id.localeCompare(b.user.id)),
                },
            },
            {
                from: hostPeerId,
                to: clientPeerIds[0],
                data: {
                    packetType: HostPacketType.USER_CONNECTED,
                    user: clients[1].user,
                },
            },
            {
                from: hostPeerId,
                to: clientPeerIds[1],
                data: {
                    packetType: HostPacketType.USER_CONNECTED,
                    user: clients[1].user,
                },
            },
            {
                from: hostPeerId,
                to: clientPeerIds[2],
                data: {
                    packetType: HostPacketType.WELCOME,
                    users: [
                        {
                            lastPingDate: expect.any(Number),
                            roundTripTime: undefined,
                            user: host.user,
                        },
                        {
                            lastPingDate: expect.any(Number),
                            roundTripTime: undefined,
                            user: clients[0].user,
                        },
                        {
                            lastPingDate: expect.any(Number),
                            roundTripTime: undefined,
                            user: clients[1].user,
                        },
                    ].sort((a, b) => a.user.id.localeCompare(b.user.id)),
                },
            },
            {
                from: hostPeerId,
                to: clientPeerIds[0],
                data: {
                    packetType: HostPacketType.USER_CONNECTED,
                    user: clients[2].user,
                },
            },
            {
                from: hostPeerId,
                to: clientPeerIds[1],
                data: {
                    packetType: HostPacketType.USER_CONNECTED,
                    user: clients[2].user,
                },
            },
            {
                from: hostPeerId,
                to: clientPeerIds[2],
                data: {
                    packetType: HostPacketType.USER_CONNECTED,
                    user: clients[2].user,
                },
            },
        ]);
    });

    it("all peers know of all users", () => {
        const expected = [
            {
                id: host.userId,
                name: "Mr. Host",
            },
            {
                id: clients[0].userId,
                name: "Mr. Client #0",
            },
            {
                id: clients[1].userId,
                name: "Mr. Client #1",
            },
            {
                id: clients[2].userId,
                name: "Mr. Client #2",
            },
        ].sort((a, b) => a.id.localeCompare(b.id));
        [host, ...clients].forEach((peer) => expect(peer.users).toEqual(expected));
    });

    describe("with a registered message", () => {
        let hostMessageFactory: MessageFactory<MockMessageType, MockPayload>;
        let clientMessageFactories: MessageFactory<MockMessageType, MockPayload>[];
        let spyMessageHost: jest.MockedFunction<any>;
        let spyMessageClients: jest.MockedFunction<any>[];

        beforeEach(async () => {
            spyMessageClients = clients.map(() => jest.fn());
            spyMessageHost = jest.fn();
            resetHistory();
            hostMessageFactory = host.message<MockPayload>(MockMessageType.MOCK_MESSAGE);
            clientMessageFactories = clients.map((client) => client.message<MockPayload>(MockMessageType.MOCK_MESSAGE));
            hostMessageFactory.subscribe(spyMessageHost);
            clientMessageFactories.forEach((factory, index) => factory.subscribe(spyMessageClients[index]));
        });

        describe("host sending the message to clients", () => {
            let sendResult: SentMessageHandle<MockMessageType, MockPayload>;

            beforeEach(async () => {
                sendResult = hostMessageFactory.send({ test: "something" });
                await sendResult.waitForAll();
            });

            it("called the listener on the host", () =>
                expect(spyMessageHost).toHaveBeenCalledWith({ test: "something" }, host.userId, expect.any(Date)));

            it("called the listeners on the clients", () =>
                spyMessageClients.forEach((spy) =>
                    expect(spy).toHaveBeenCalledWith({ test: "something" }, host.userId, expect.any(Date)),
                ));
        });

        describe("client sending the message to specific client", () => {
            let sendResult: SentMessageHandle<MockMessageType, MockPayload>;

            beforeEach(async () => {
                sendResult = clientMessageFactories[0].send({ test: "something" }, clients[1].userId);
                await sendResult.waitForAll();
            });

            it("didn't the listeners that weren't the target", () =>
                [spyMessageHost, spyMessageClients[0], spyMessageClients[2]].forEach((spy) =>
                    expect(spy).not.toHaveBeenCalled(),
                ));

            it("called the listeners on the target client", () =>
                [spyMessageClients[1]].forEach((spy) =>
                    expect(spy).toHaveBeenCalledWith({ test: "something" }, clients[0].userId, expect.any(Date)),
                ));

            it("has sent the expected messages", () => {
                expect(getHistory()).toEqual([
                    {
                        from: clientPeerIds[0],
                        to: hostPeerId,
                        data: {
                            packetType: ClientPacketType.MESSAGE,
                            message: {
                                createdDate: expect.any(Number),
                                messageType: MockMessageType.MOCK_MESSAGE,
                                originUserId: clients[0].userId,
                                serialId: sendResult.message.serialId,
                                payload: {
                                    test: "something",
                                },
                            },
                            targets: [clients[1].userId],
                        },
                    },
                    {
                        from: hostPeerId,
                        to: clientPeerIds[0],
                        data: {
                            packetType: HostPacketType.ACKNOWLEDGED_BY_HOST,
                            serialId: sendResult.message.serialId,
                        },
                    },
                    {
                        from: hostPeerId,
                        to: clientPeerIds[1],
                        data: {
                            packetType: HostPacketType.RELAYED_MESSAGE,
                            message: {
                                createdDate: expect.any(Number),
                                messageType: MockMessageType.MOCK_MESSAGE,
                                originUserId: clients[0].userId,
                                serialId: sendResult.message.serialId,
                                payload: {
                                    test: "something",
                                },
                            },
                        },
                    },
                    {
                        from: clientPeerIds[1],
                        to: hostPeerId,
                        data: {
                            packetType: ClientPacketType.ACKNOWLEDGE,
                            serialId: sendResult.message.serialId,
                        },
                    },
                    {
                        from: hostPeerId,
                        to: clientPeerIds[0],
                        data: {
                            packetType: HostPacketType.ACKNOWLEDGED_BY_ALL,
                            serialId: sendResult.message.serialId,
                        },
                    },
                ]);
            });
        });

        describe("client sending the message to host", () => {
            let sendResult: SentMessageHandle<MockMessageType, MockPayload>;

            beforeEach(async () => {
                sendResult = clientMessageFactories[0].send({ test: "something" });
                await sendResult.waitForAll();
            });

            it("called the listener on the host", () =>
                expect(spyMessageHost).toHaveBeenCalledWith(
                    { test: "something" },
                    clients[0].userId,
                    expect.any(Date),
                ));

            it("called the listeners on the clients", () =>
                spyMessageClients.forEach((spy) =>
                    expect(spy).toHaveBeenCalledWith({ test: "something" }, clients[0].userId, expect.any(Date)),
                ));

            it("has sent the expected messages", () => {
                expect(getHistory()).toEqual([
                    {
                        from: clientPeerIds[0],
                        to: hostPeerId,
                        data: {
                            packetType: ClientPacketType.MESSAGE,
                            message: {
                                createdDate: expect.any(Number),
                                messageType: MockMessageType.MOCK_MESSAGE,
                                originUserId: clients[0].userId,
                                serialId: sendResult.message.serialId,
                                payload: {
                                    test: "something",
                                },
                            },
                        },
                    },
                    {
                        from: hostPeerId,
                        to: clientPeerIds[0],
                        data: {
                            packetType: HostPacketType.ACKNOWLEDGED_BY_HOST,
                            serialId: sendResult.message.serialId,
                        },
                    },
                    {
                        from: hostPeerId,
                        to: clientPeerIds[0],
                        data: {
                            packetType: HostPacketType.RELAYED_MESSAGE,
                            message: {
                                createdDate: expect.any(Number),
                                messageType: MockMessageType.MOCK_MESSAGE,
                                originUserId: clients[0].userId,
                                serialId: sendResult.message.serialId,
                                payload: {
                                    test: "something",
                                },
                            },
                        },
                    },
                    {
                        from: hostPeerId,
                        to: clientPeerIds[1],
                        data: {
                            packetType: HostPacketType.RELAYED_MESSAGE,
                            message: {
                                createdDate: expect.any(Number),
                                messageType: MockMessageType.MOCK_MESSAGE,
                                originUserId: clients[0].userId,
                                serialId: sendResult.message.serialId,
                                payload: {
                                    test: "something",
                                },
                            },
                        },
                    },
                    {
                        from: hostPeerId,
                        to: clientPeerIds[2],
                        data: {
                            packetType: HostPacketType.RELAYED_MESSAGE,
                            message: {
                                createdDate: expect.any(Number),
                                messageType: MockMessageType.MOCK_MESSAGE,
                                originUserId: clients[0].userId,
                                serialId: sendResult.message.serialId,
                                payload: {
                                    test: "something",
                                },
                            },
                        },
                    },
                    {
                        from: clientPeerIds[0],
                        to: hostPeerId,
                        data: {
                            packetType: ClientPacketType.ACKNOWLEDGE,
                            serialId: sendResult.message.serialId,
                        },
                    },
                    {
                        from: clientPeerIds[1],
                        to: hostPeerId,
                        data: {
                            packetType: ClientPacketType.ACKNOWLEDGE,
                            serialId: sendResult.message.serialId,
                        },
                    },
                    {
                        from: clientPeerIds[2],
                        to: hostPeerId,
                        data: {
                            packetType: ClientPacketType.ACKNOWLEDGE,
                            serialId: sendResult.message.serialId,
                        },
                    },
                    {
                        from: hostPeerId,
                        to: clientPeerIds[0],
                        data: {
                            packetType: HostPacketType.ACKNOWLEDGED_BY_ALL,
                            serialId: sendResult.message.serialId,
                        },
                    },
                ]);
            });
        });
    });

    describe("with a client being broken", () => {
        let pingResult: any;
        let spyDisconnect: jest.MockedFunction<any>;

        beforeEach(async () => {
            spyDisconnect = jest.fn();
            clients[0].on("userdisconnect", spyDisconnect);
            (clients[1] as any).handleHostPacket = () => undefined;
            try {
                await host.ping();
            } catch (err) {
                pingResult = err;
            }
            await new Promise((resolve) => setTimeout(resolve));
        });

        it("fired 'userdisconnect'", () => expect(spyDisconnect).toHaveBeenCalledWith(clients[1].userId));

        it("rejects the ping", () => expect(pingResult).toEqual(expect.any(Error)));

        it("all peers removed the user", () => {
            const expected = [
                {
                    id: host.userId,
                    name: "Mr. Host",
                },
                {
                    id: clients[0].userId,
                    name: "Mr. Client #0",
                },
                {
                    id: clients[2].userId,
                    name: "Mr. Client #2",
                },
            ].sort((a, b) => a.id.localeCompare(b.id));
            [host, clients[0], clients[2]].forEach((peer) => expect(peer.users).toEqual(expected));
        });
    });

    describe("ping", () => {
        let spyDate: jest.SpiedFunction<any>;
        const now = 1590160273660;
        let pingInfos: PingInfo[];

        beforeEach(async () => {
            pingInfos = [
                {
                    userId: host.userId,
                    roundTripTime: 0,
                    lastPingDate: now,
                },
                {
                    userId: clients[0].userId,
                    roundTripTime: 0,
                    lastPingDate: now,
                },
                {
                    userId: clients[1].userId,
                    roundTripTime: 0,
                    lastPingDate: now,
                },
                {
                    userId: clients[2].userId,
                    roundTripTime: 0,
                    lastPingDate: now,
                },
            ].sort((a, b) => a.userId.localeCompare(b.userId));
            resetHistory();
            spyDate = jest.spyOn(Date, "now").mockImplementation(() => now);
            await host.ping();
            await new Promise((resolve) => setTimeout(resolve));
        });

        afterEach(() => spyDate.mockRestore());

        it("has sent the expected messages", () => {
            expect(getHistory()).toEqual([
                {
                    from: hostPeerId,
                    to: clientPeerIds[0],
                    data: {
                        packetType: HostPacketType.PING,
                        initiationDate: now,
                    },
                },
                {
                    from: hostPeerId,
                    to: clientPeerIds[1],
                    data: {
                        packetType: HostPacketType.PING,
                        initiationDate: now,
                    },
                },
                {
                    from: hostPeerId,
                    to: clientPeerIds[2],
                    data: {
                        packetType: HostPacketType.PING,
                        initiationDate: now,
                    },
                },
                {
                    from: clientPeerIds[0],
                    to: hostPeerId,
                    data: {
                        packetType: ClientPacketType.PONG,
                        initiationDate: now,
                    },
                },
                {
                    from: clientPeerIds[1],
                    to: hostPeerId,
                    data: {
                        packetType: ClientPacketType.PONG,
                        initiationDate: now,
                    },
                },
                {
                    from: clientPeerIds[2],
                    to: hostPeerId,
                    data: {
                        packetType: ClientPacketType.PONG,
                        initiationDate: now,
                    },
                },
                {
                    from: hostPeerId,
                    to: clientPeerIds[0],
                    data: {
                        packetType: HostPacketType.PING_INFO,
                        pingInfos,
                    },
                },
                {
                    from: hostPeerId,
                    to: clientPeerIds[1],
                    data: {
                        packetType: HostPacketType.PING_INFO,
                        pingInfos,
                    },
                },
                {
                    from: hostPeerId,
                    to: clientPeerIds[2],
                    data: {
                        packetType: HostPacketType.PING_INFO,
                        pingInfos,
                    },
                },
            ]);
        });

        it("has the ping infos available in all peers", () => {
            [host, ...clients].forEach((peer) =>
                expect(
                    Array.from(peer.pingInfos.entries()).map(([userId, { lastPingDate, roundTripTime }]) => ({
                        lastPingDate,
                        roundTripTime,
                        userId: userId,
                    })),
                ).toEqual(pingInfos),
            );
        });
    });
});