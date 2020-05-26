jest.mock("peerjs");
import {
    Host,
    Client,
    ClientPacketType,
    HostPacketType,
    MessageFactory,
    SentMessageHandle,
    ErrorReason,
    createHost,
    createClient,
    IncompatibilityError,
    IncompatibleVersion,
} from "../src";
import { resetHistory, getHistory } from "./packet-history";
import { libraryVersion } from "../generated/version";
import * as peerjs from "peerjs";

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
let host: Host<MockUser, MockMessageType>;
let client: Client<MockUser, MockMessageType>;

describe("With ping interval", () => {
    let spyPing: jest.MockedFunction<any>;

    beforeEach(async (done) => {
        spyPing = jest.fn(() => {
            host.stopPing();
            done();
        });
        host = await createHost({
            pingInterval: 0.001,
            applicationProtocolVersion: "some",
            user: { name: "test" },
        });
        client = await createClient(
            { applicationProtocolVersion: "some", user: { name: "test" } },
            host.hostConnectionId!,
        );
        resetHistory();
        client.once("pinginfo", spyPing);
    });

    it("calls the ping handler", () => expect(spyPing).toBeCalled());
});

describe("createClient() and createHost()", () => {
    beforeEach(async () => {
        host = await createHost({ applicationProtocolVersion: "some", user: { name: "test" } });
        client = await createClient(
            { applicationProtocolVersion: "some", user: { name: "test" } },
            host.hostConnectionId!,
        );
    });

    it("client is client", () => expect(client.isClient).toBe(true));
    it("client is not host", () => expect(client.isHost).toBe(false));
    it("client is connected", () => expect(client.isConnected).toBe(true));
    it("client is not connecting", () => expect(client.isConnecting).toBe(false));
    it("client is not disconnected", () => expect(client.isDisconnected).toBe(false));
    it("host is not client", () => expect(host.isClient).toBe(false));
    it("host is host", () => expect(host.isHost).toBe(true));
});

describe("With the peer not being created", () => {
    beforeEach(() =>
        jest.spyOn(peerjs as any, "default").mockImplementation(
            () =>
                class {
                    public on(name: string, handler: any): void {
                        if (name === "error") {
                            handler(new Error("some error"));
                        }
                    }
                },
        ),
    );

    afterEach(() => jest.spyOn(peerjs as any, "default").mockRestore());

    it("can't create host", () =>
        expect(createHost({ applicationProtocolVersion: "some", user: { name: "test" } })).rejects.toEqual(
            expect.any(Error),
        ));
});

describe("Incompatible versions", () => {
    let rejectResult: any;

    beforeEach(async () => {
        host = await createHost({ applicationProtocolVersion: "1", user: { name: "test" } });
        try {
            client = await createClient(
                { applicationProtocolVersion: "2", user: { name: "test" } },
                host.hostConnectionId!,
            );
        } catch (err) {
            rejectResult = err;
        }
    });

    it("can't connect", () => {
        expect(rejectResult).toEqual(expect.any(IncompatibilityError));
        expect(rejectResult.incompatibleVersions).toEqual([IncompatibleVersion.APPLICATION_PROTOCOL_VERSION]);
        expect(rejectResult.localVersions).toEqual({ application: "2", p2pNetwork: libraryVersion });
        expect(rejectResult.hostVersions).toEqual({ application: "1", p2pNetwork: libraryVersion });
    });
});

describe("With peerjs encountering an error", () => {
    let rejectResult: any;

    beforeEach(async () => {
        try {
            await client.open("broken-id");
        } catch (err) {
            rejectResult = err;
        }
    });

    it("rejects", () => expect(rejectResult).toEqual(expect.any(Error)));
});

describe("Simple", () => {
    let hostPeerId: string;
    let clientPeerId: string;

    beforeEach(() => {
        resetHistory();
        const options = { timeout: 0.02, applicationProtocolVersion: "1.0.0" };
        host = new Host({ ...options, user: { name: "Mr. Host" } });
        client = new Client({ ...options, user: { name: "Mr. Client" } });
    });

    it("host has no connection id", () => expect(host.hostConnectionId).toBe(undefined));

    it("client is not client", () => expect(client.isClient).toBe(false));
    it("client is not host", () => expect(client.isHost).toBe(false));
    it("client is not connected", () => expect(client.isConnected).toBe(false));
    it("client is not connecting", () => expect(client.isConnecting).toBe(false));
    it("client is disconnected", () => expect(client.isDisconnected).toBe(true));

    it("can't close peer that isn't open", () => expect(() => host.close()).toThrowError());

    it("can stop pinging with no effect", () => expect(() => host.stopPing()).not.toThrowError());

    describe("sending on closed connection", () => {
        let spyError: jest.MockedFunction<any>;
        let rejectResult: any;

        beforeEach(async () => {
            spyError = jest.fn();
            client.once("error", spyError);
            try {
                await client.message(MockMessageType.MOCK_MESSAGE).send({ test: "test" }).waitForHost();
            } catch (err) {
                rejectResult = err;
            }
        });

        it("rejects", () => expect(rejectResult).toEqual(expect.any(Error)));

        it("called the error handler", () =>
            expect(spyError).toHaveBeenCalledWith(expect.any(Error), ErrorReason.OTHER));
    });

    describe("after opening", () => {
        beforeEach(async () => {
            resetHistory();
            const hostOpenResult = await host.open();
            hostPeerId = hostOpenResult.peerId;
            const clientOpenResult = await client.open(hostPeerId);
            clientPeerId = clientOpenResult.peerId;
        });

        it("host knows both users", () =>
            expect(host.users).toEqual([host.user, client.user].sort((a, b) => a.id.localeCompare(b.id))));
        it("client knows both users", () =>
            expect(client.users).toEqual([host.user, client.user].sort((a, b) => a.id.localeCompare(b.id))));

        it("client is client", () => expect(client.isClient).toBe(true));
        it("client is not host", () => expect(client.isHost).toBe(false));
        it("client is connected", () => expect(client.isConnected).toBe(true));
        it("client is not connecting", () => expect(client.isConnecting).toBe(false));
        it("client is not disconnected", () => expect(client.isDisconnected).toBe(false));
        it("host is not client", () => expect(host.isClient).toBe(false));
        it("host is host", () => expect(host.isHost).toBe(true));

        it("has the same host connection ids for both peers", () =>
            expect(host.hostConnectionId).toBe(client.hostConnectionId));

        describe("after closing the connection to the client", () => {
            beforeEach(async () => {
                host.closeConnectionToClient(client.userId);
                await new Promise((resolve) => setTimeout(resolve));
            });

            it("removed the client from the set of users", () => expect(host.users).toEqual([host.user]));
        });

        it("can't close connection to itself", () =>
            expect(() => host.closeConnectionToClient(host.userId)).toThrowError());

        describe("after closing the connection to an unknown client", () => {
            let spyError: jest.MockedFunction<any>;

            beforeEach(async () => {
                spyError = jest.fn();
                host.once("error", spyError);
                host.closeConnectionToClient("unknown-id");
            });

            it("calls the error handler", () =>
                expect(spyError).toHaveBeenCalledWith(expect.any(Error), ErrorReason.INTERNAL));
        });

        describe("after updating the user", () => {
            let spyUserUpdate: jest.MockedFunction<any>;
            let spyUserUpdateRemoved: jest.MockedFunction<any>;

            beforeEach(async () => {
                spyUserUpdate = jest.fn();
                spyUserUpdateRemoved = jest.fn();
                host.on("userupdate", spyUserUpdate);
                host.on("userupdate", spyUserUpdateRemoved);
                host.removeEventListener("userupdate", spyUserUpdateRemoved);
                resetHistory();
                await client.updateUser({ name: "Mr. Newname" });
            });

            it("fires the event", () =>
                expect(spyUserUpdate).toHaveBeenCalledWith({ id: client.userId, name: "Mr. Newname" }));

            it("doesn't call removed event listener", () => expect(spyUserUpdateRemoved).not.toHaveBeenCalled());

            it("has sent the expected Packets", () => {
                expect(getHistory()).toEqual([
                    {
                        from: clientPeerId,
                        to: hostPeerId,
                        data: {
                            packetType: ClientPacketType.UPDATE_USER,
                            user: {
                                name: "Mr. Newname",
                            },
                        },
                    },
                    {
                        from: hostPeerId,
                        to: clientPeerId,
                        data: {
                            packetType: HostPacketType.UPDATE_USER,
                            user: {
                                id: client.userId,
                                name: "Mr. Newname",
                            },
                        },
                    },
                ]);
            });

            it("updates the user", () => {
                [client, host].forEach((peer) =>
                    expect(peer.users).toEqual(
                        [
                            {
                                id: host.userId,
                                name: "Mr. Host",
                            },
                            {
                                id: client.userId,
                                name: "Mr. Newname",
                            },
                        ].sort((a, b) => a.id.localeCompare(b.id)),
                    ),
                );
            });
        });

        describe("after disconnecting", () => {
            let spyUserDisconnect: jest.MockedFunction<any>;

            beforeEach((done) => {
                spyUserDisconnect = jest.fn(() => done());
                host.on("userdisconnect", spyUserDisconnect);
                resetHistory();
                client.close();
            });

            it("fires the event", () => expect(spyUserDisconnect).toHaveBeenCalledWith(client.userId));

            it("has sent the expected Packets", () => {
                expect(getHistory()).toEqual([
                    {
                        from: clientPeerId,
                        to: hostPeerId,
                        data: {
                            packetType: ClientPacketType.DISCONNECT,
                        },
                    },
                    {
                        from: hostPeerId,
                        to: clientPeerId,
                        data: {
                            packetType: HostPacketType.USER_DISCONNECTED,
                            userId: client.userId,
                        },
                    },
                ]);
            });

            it("removed the user from host's users", () => {
                expect(host.users).toEqual([
                    {
                        id: host.userId,
                        name: "Mr. Host",
                    },
                ]);
            });
        });

        it("has sent the expected Packets", () => {
            expect(getHistory()).toEqual([
                {
                    from: clientPeerId,
                    to: hostPeerId,
                    data: {
                        packetType: ClientPacketType.HELLO,
                        versions: {
                            application: "1.0.0",
                            p2pNetwork: libraryVersion,
                        },
                        user: client.user,
                    },
                },
                {
                    from: hostPeerId,
                    to: clientPeerId,
                    data: {
                        packetType: HostPacketType.WELCOME,
                        users: [
                            {
                                lastPingDate: expect.any(Number),
                                roundTripTime: undefined,
                                user: host.user,
                            },
                        ],
                    },
                },
                {
                    from: hostPeerId,
                    to: clientPeerId,
                    data: {
                        packetType: HostPacketType.USER_CONNECTED,
                        user: client.user,
                    },
                },
            ]);
        });

        it("has both users on host side", () => {
            const expected = [
                {
                    id: host.userId,
                    name: "Mr. Host",
                },
                {
                    id: client.userId,
                    name: "Mr. Client",
                },
            ].sort((a, b) => a.id.localeCompare(b.id));
            expect(host.users).toEqual(expected);
        });

        describe("with a registered message", () => {
            let hostMessage: MessageFactory<MockMessageType, MockPayload>;
            let clientMessage: MessageFactory<MockMessageType, MockPayload>;
            let spyMessageHost: jest.MockedFunction<any>;
            let spyMessageClient: jest.MockedFunction<any>;

            beforeEach(async () => {
                spyMessageClient = jest.fn();
                spyMessageHost = jest.fn();
                resetHistory();
                hostMessage = host.message<MockPayload>(MockMessageType.MOCK_MESSAGE);
                clientMessage = client.message<MockPayload>(MockMessageType.MOCK_MESSAGE);
                hostMessage.subscribe(spyMessageHost);
                clientMessage.subscribe(spyMessageClient);
            });

            describe("with the client ignoring the serial from itself", () => {
                let hostAwaited: boolean;
                let allAwaited: boolean;
                let hostError: Error;
                let allError: Error;

                beforeEach(async () => {
                    hostAwaited = false;
                    allAwaited = false;
                    const message = clientMessage.send({ test: "some" });
                    client.ignoreSerialId(message.message.serialId);
                    await Promise.race([
                        message
                            .waitForHost()
                            .then(() => (hostAwaited = true))
                            .catch((err) => (hostError = err)),
                        new Promise((resolve) => setTimeout(resolve, 1)),
                    ]);
                    await Promise.race([
                        message
                            .waitForAll()
                            .then(() => (allAwaited = true))
                            .catch((err) => (allError = err)),
                        new Promise((resolve) => setTimeout(resolve, 1)),
                    ]);
                });

                it("doesn't resolve for host", () => expect(hostAwaited).toBe(false));
                it("doesn't resolve for all", () => expect(allAwaited).toBe(false));
                it("has error for host", () => expect(hostError).toEqual(expect.any(Error)));
                it("has error for all", () => expect(allError).toEqual(expect.any(Error)));
            });

            describe("with the client ignoring the serial from the host", () => {
                beforeEach(async () => {
                    const message = hostMessage.send({ test: "some" });
                    client.ignoreSerialId(message.message.serialId);
                    await message.waitForHost();
                });

                it("doesn't call the subscription", () => expect(spyMessageClient).not.toHaveBeenCalled());
            });

            describe("with the client being broken", () => {
                beforeEach(() => {
                    (client as any).handleHostPacket = () => undefined;
                });

                describe("with the host being broken", () => {
                    beforeEach(() => {
                        (host as any).handleHostPacket = () => undefined;
                    });

                    describe("host sending the message to client", () => {
                        let sendResult: SentMessageHandle<MockMessageType, MockPayload>;
                        let promiseWaitForHost: Promise<any>;
                        let promiseWaitForAll: Promise<any>;

                        beforeEach(async () => {
                            sendResult = hostMessage.send({ test: "something" });
                            promiseWaitForAll = sendResult.waitForAll();
                            // See https://github.com/facebook/jest/issues/6028#issuecomment-567669082
                            promiseWaitForAll.catch(() => undefined);
                            promiseWaitForHost = sendResult.waitForHost();
                            // See https://github.com/facebook/jest/issues/6028#issuecomment-567669082
                            promiseWaitForHost.catch(() => undefined);
                            await new Promise((resolve) => setTimeout(resolve, 20));
                        });

                        it("rejected waitForHost()", () =>
                            expect(promiseWaitForHost).rejects.toThrow(expect.any(Error)));

                        it("rejected waitForAll()", () => expect(promiseWaitForAll).rejects.toThrow(expect.any(Error)));
                    });
                });

                describe("host sending the message to client", () => {
                    let sendResult: SentMessageHandle<MockMessageType, MockPayload>;
                    let promiseWaitForHost: Promise<any>;
                    let promiseWaitForAll: Promise<any>;

                    beforeEach(async () => {
                        sendResult = hostMessage.send({ test: "something" });
                        promiseWaitForAll = sendResult.waitForAll();
                        // See https://github.com/facebook/jest/issues/6028#issuecomment-567669082
                        promiseWaitForAll.catch(() => undefined);
                        promiseWaitForHost = sendResult.waitForHost();
                        await new Promise((resolve) => setTimeout(resolve, 20));
                    });

                    it("resolved waitForHost()", () => expect(promiseWaitForHost).resolves.toBeUndefined());

                    it("rejected waitForAll()", () => expect(promiseWaitForAll).rejects.toThrow(expect.any(Error)));
                });
            });

            describe("host sending the message to client", () => {
                let sendResult: SentMessageHandle<MockMessageType, MockPayload>;

                beforeEach(async () => {
                    sendResult = hostMessage.send({ test: "something" });
                    await sendResult.waitForAll();
                });

                it("called the listener on the host", () =>
                    expect(spyMessageHost).toHaveBeenCalledWith({ test: "something" }, host.userId, expect.any(Date)));

                it("called the listener on the client", () =>
                    expect(spyMessageClient).toHaveBeenCalledWith(
                        { test: "something" },
                        host.userId,
                        expect.any(Date),
                    ));
            });

            describe("client sending the message to host", () => {
                let sendResult: SentMessageHandle<MockMessageType, MockPayload>;

                beforeEach(async () => {
                    resetHistory();
                    sendResult = clientMessage.send({ test: "something" });
                    await sendResult.waitForAll();
                });

                it("called the listener on the host", () =>
                    expect(spyMessageHost).toHaveBeenCalledWith(
                        { test: "something" },
                        client.userId,
                        expect.any(Date),
                    ));

                it("called the listener on the client", () =>
                    expect(spyMessageClient).toHaveBeenCalledWith(
                        { test: "something" },
                        client.userId,
                        expect.any(Date),
                    ));

                it("has sent the expected Packets", () => {
                    expect(getHistory()).toEqual([
                        {
                            from: clientPeerId,
                            to: hostPeerId,
                            data: {
                                packetType: ClientPacketType.MESSAGE,
                                message: {
                                    createdDate: expect.any(Number),
                                    messageType: MockMessageType.MOCK_MESSAGE,
                                    originUserId: client.userId,
                                    serialId: sendResult.message.serialId,
                                    payload: {
                                        test: "something",
                                    },
                                },
                            },
                        },
                        {
                            from: hostPeerId,
                            to: clientPeerId,
                            data: {
                                packetType: HostPacketType.ACKNOWLEDGED_BY_HOST,
                                serialId: sendResult.message.serialId,
                            },
                        },
                        {
                            from: hostPeerId,
                            to: clientPeerId,
                            data: {
                                packetType: HostPacketType.RELAYED_MESSAGE,
                                message: {
                                    createdDate: expect.any(Number),
                                    messageType: MockMessageType.MOCK_MESSAGE,
                                    originUserId: client.userId,
                                    serialId: sendResult.message.serialId,
                                    payload: {
                                        test: "something",
                                    },
                                },
                            },
                        },
                        {
                            from: clientPeerId,
                            to: hostPeerId,
                            data: {
                                packetType: ClientPacketType.ACKNOWLEDGE,
                                serialId: sendResult.message.serialId,
                            },
                        },
                        {
                            from: hostPeerId,
                            to: clientPeerId,
                            data: {
                                packetType: HostPacketType.ACKNOWLEDGED_BY_ALL,
                                serialId: sendResult.message.serialId,
                            },
                        },
                    ]);
                });
            });
        });
    });
});