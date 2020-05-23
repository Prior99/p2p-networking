import PeerJS from "peerjs";
import { Users } from "./users";
import { ClientPacket, HostPacket, HostPacketType, ClientPacketType, Message, PingInfo, User } from "./types";
import { unreachable, PromiseListener, resolvePromiseListeners, rejectPromiseListeners } from "./utils";
import { v4 as uuid } from "uuid";

export type EventHandler<TPayload> = (payload: TPayload, userId: string, createdDate: Date) => void;
export type Unsubscribe = () => void;

export interface SendEventManager<TPayload> {
    event: Message<TPayload>;
    waitForHost: () => Promise<void>;
    waitForAll: () => Promise<void>;
}

export interface EventManager<TPayload> {
    subscribe: (handler: EventHandler<TPayload>) => Unsubscribe;
    send: (payload: TPayload) => SendEventManager<TPayload>;
}

export interface EventMeta<TPayload> {
    eventId: string;
    subscriptions: Set<EventHandler<TPayload>>;
}

export interface PendingEventManager<TPayload> {
    event: Message<TPayload>;
    waitForHostListeners: Set<PromiseListener<[void], [Error]>>;
    waitForAllListeners: Set<PromiseListener<[void], [Error]>>;
    timeout: ReturnType<typeof setTimeout>;
}

export interface PeerOptions<TUser extends User> {
    timeout?: number;
    applicationProtocolVersion: string;
    user: Omit<TUser, "id">;
}

export interface PeerOpenResult {
    peerId: string;
    userId: string;
}

export const peerDefaultOptions = {
    timeout: 5,
};

export type PeerEvent = "event" | "userconnect" | "userdisconnect" | "pinginfo" | "connect" | "userupdate";
export type PeerEventArguments<TEvent extends PeerEvent, TUser extends User> = {
    "event": [Message<unknown>, string, Date];
    "userconnect": [TUser];
    "userdisconnect": [string];
    "pinginfo": [Map<string, PingInfo>];
    "connect": [];
    "userupdate": [TUser];
}[TEvent];
export type PeerEventListener<TEvent extends PeerEvent, TUser extends User> = (
    ...args: PeerEventArguments<TEvent, TUser>
) => void;

export abstract class Peer<TUser extends User, TEventId> {
    public users = new Users<TUser>();
    public userId = uuid();
    public readonly options: Required<PeerOptions<TUser>>;
    public abstract hostPeerId: string | undefined;

    protected peer?: PeerJS;
    protected events = new Map<string, EventMeta<any>>(); // eslint-disable-line
    protected pendingEvents = new Map<string, PendingEventManager<any>>(); // eslint-disable-line
    protected ignoredSerialIds = new Set<string>();
    protected sequenceNumber = 0;
    protected eventListeners: { [TKey in PeerEvent]: Set<PeerEventListener<TKey, TUser>> } = {
        event: new Set(),
        userconnect: new Set(),
        userdisconnect: new Set(),
        pinginfo: new Set(),
        connect: new Set(),
        userupdate: new Set(),
    };

    constructor(inputOptions: PeerOptions<TUser>) {
        this.users.addUser({
            ...inputOptions.user,
            id: this.userId,
        } as any); // eslint-disable-line
        this.options = {
            ...peerDefaultOptions,
            ...inputOptions,
        };
    }

    public get ownUser(): TUser {
        return this.users.getUser(this.userId)!;
    }

    public on<TPeerEvent extends PeerEvent>(
        eventName: TPeerEvent,
        handler: (...args: PeerEventArguments<TPeerEvent, TUser>) => void,
    ): void {
        this.eventListeners[eventName].add(handler);
    }

    public addEventListener = this.on;

    public removeEventListener<TPeerEvent extends PeerEvent>(
        eventName: TPeerEvent,
        handler: (...args: PeerEventArguments<TPeerEvent, TUser>) => void,
    ): void {
        this.eventListeners[eventName].delete(handler);
    }

    protected emitEvent<TPeerEvent extends PeerEvent>(
        eventName: TPeerEvent,
        ...args: PeerEventArguments<TPeerEvent, TUser>
    ): void {
        const listeners = this.eventListeners[eventName] as Set<PeerEventListener<TPeerEvent, TUser>>;
        listeners.forEach((listener) => listener(...args));
    }

    public updateUser(user: Partial<TUser>): void {
        this.sendClientMessage({
            packetType: ClientPacketType.UPDATE_USER,
            user: {
                ...user,
                id: this.userId,
            },
        });
    }

    public event<TPayload>(eventId: TEventId): EventManager<TPayload> {
        const eventIdString = String(eventId);
        const eventMeta: EventMeta<TPayload> = {
            eventId: eventIdString,
            subscriptions: new Set(),
        };
        this.events.set(eventIdString, eventMeta);
        const eventManager: EventManager<TPayload> = {
            subscribe: (handler: EventHandler<TPayload>) => {
                eventMeta.subscriptions.add(handler);
                return () => eventMeta.subscriptions.delete(handler);
            },
            send: (payload: TPayload) => {
                const event = this.sendEvent(eventIdString, payload);
                const pendingEventManager: PendingEventManager<TPayload> = {
                    event,
                    waitForHostListeners: new Set(),
                    waitForAllListeners: new Set(),
                    timeout: setTimeout(() => {
                        const error = new Error(
                            `Timeout: No acknowledge for event "${event.eventId}" with serial "${event.serialId}" within ${this.options.timeout} seconds.`,
                        );
                        rejectPromiseListeners(Array.from(pendingEventManager.waitForHostListeners.values()), error);
                        rejectPromiseListeners(Array.from(pendingEventManager.waitForAllListeners.values()), error);
                        this.ignoreSerialId(event.eventId);
                        this.pendingEvents.delete(event.serialId);
                    }, this.options.timeout * 1000),
                };
                this.pendingEvents.set(event.serialId, pendingEventManager);
                return {
                    event,
                    waitForHost: () => {
                        return new Promise((resolve, reject) => {
                            pendingEventManager.waitForHostListeners.add({ resolve, reject });
                        });
                    },
                    waitForAll: () => {
                        return new Promise((resolve, reject) => {
                            pendingEventManager.waitForAllListeners.add({ resolve, reject });
                        });
                    },
                };
            },
        };
        return eventManager;
    }

    protected abstract sendClientMessage<TEventPayload>(message: ClientPacket<TUser, TEventPayload>): void;

    protected handleHostMessage<TEventPayload>(message: HostPacket<TUser, TEventPayload>): void {
        switch (message.packetType) {
            case HostPacketType.WELCOME:
                this.users.initialize(message.users);
                this.emitEvent("connect");
                break;
            case HostPacketType.USER_CONNECTED:
                this.users.addUser(message.user);
                this.emitEvent("userconnect", message.user);
                break;
            case HostPacketType.USER_DISCONNECTED:
                this.users.removeUser(message.userId);
                this.emitEvent("userdisconnect", message.userId);
                break;
            case HostPacketType.PING:
                this.sendClientMessage({
                    packetType: ClientPacketType.PONG,
                    initiationDate: message.initiationDate,
                    sequenceNumber: ++this.sequenceNumber,
                });
                break;
            case HostPacketType.RELAYED_MESSAGE:
                this.receivedEvent(message.message);
                break;
            case HostPacketType.ACKNOWLEDGED_BY_HOST:
                this.eventAcknowledgedByHost(message.serialId);
                break;
            case HostPacketType.ACKNOWLEDGED_BY_ALL:
                this.eventAcknowledgedByAll(message.serialId);
                break;
            case HostPacketType.PING_INFO: {
                const map = new Map<string, PingInfo>();
                for (const { userId, ...pingInfo } of message.pingInfos) {
                    this.users.updatePingInfo(userId, pingInfo);
                    map.set(userId, pingInfo);
                }
                this.emitEvent("pinginfo", map);
                break;
            }
            case HostPacketType.UPDATE_USER:
                this.users.updateUser(message.user.id, message.user);
                this.emitEvent("userupdate", this.users.getUser(message.user.id)!);
                break;
            case HostPacketType.INCOMPATIBLE:
                throw new Error("Incompatible with host.");
                break;
            default:
                unreachable(message);
        }
    }

    private receivedEvent<TEventPayload>(event: Message<TEventPayload>): void {
        if (this.ignoredSerialIds.has(event.serialId)) {
            return;
        }
        this.sendClientMessage({
            packetType: ClientPacketType.ACKNOWLEDGE,
            serialId: event.serialId,
        });
        const eventManager = this.events.get(event.eventId);
        if (!eventManager) {
            throw new Error(`Received unknown event with id "${event.eventId}".`);
        }
        const createdDate = new Date(event.createdDate);
        this.emitEvent("event", event, event.originUserId, createdDate);
        eventManager.subscriptions.forEach((subscription) =>
            subscription(event.payload, event.originUserId, createdDate),
        );
    }

    private eventAcknowledgedByHost(serialId: string): void {
        if (this.ignoredSerialIds.has(serialId)) {
            return;
        }
        const pendingEvent = this.pendingEvents.get(serialId);
        if (!pendingEvent) {
            throw new Error(`Inconsistency detected. No pending event with serial id "${serialId}".`);
        }
        resolvePromiseListeners(Array.from(pendingEvent.waitForHostListeners.values()));
    }

    private eventAcknowledgedByAll(serialId: string): void {
        if (this.ignoredSerialIds.has(serialId)) {
            return;
        }
        const pendingEvent = this.pendingEvents.get(serialId);
        if (!pendingEvent) {
            throw new Error(`Inconsistency detected. No pending event with serial id "${serialId}".`);
        }
        resolvePromiseListeners(Array.from(pendingEvent.waitForAllListeners.values()));
        clearTimeout(pendingEvent.timeout);
        this.pendingEvents.delete(serialId);
    }

    public close(): void {
        if (!this.peer) {
            throw new Error("Can't close peer. Not connected.");
        }
        this.sendClientMessage({
            packetType: ClientPacketType.DISCONNECT,
        });
        this.peer.destroy();
    }

    protected async createLocalPeer(): Promise<PeerOpenResult> {
        await new Promise((resolve) => {
            this.peer = new PeerJS(null as any, { host: "localhost", port: 9000, path: "/myapp"}); // eslint-disable-line
            this.peer.on("open", () => resolve());
        });
        if (!this.peer) {
            throw new Error("Connection id could not be determined.");
        }
        return {
            peerId: this.peer.id,
            userId: this.userId,
        };
    }

    protected sendToPeer<TEventPayload>(
        connection: PeerJS.DataConnection,
        message: HostPacket<TUser, TEventPayload> | ClientPacket<TUser, TEventPayload>,
    ): void {
        connection.send(message);
    }

    protected sendEvent<TPayload>(eventId: string, payload: TPayload): Message<TPayload> {
        const event: Message<TPayload> = {
            eventId,
            originUserId: this.userId,
            payload,
            createdDate: Date.now(),
            serialId: uuid(),
        };
        setTimeout(() =>
            this.sendClientMessage({
                packetType: ClientPacketType.MESSAGE,
                message: event,
            }),
        );
        return event;
    }

    public ignoreSerialId(serialId: string): void {
        this.ignoredSerialIds.add(serialId);
    }
}
