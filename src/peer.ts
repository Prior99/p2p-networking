import PeerJS from "peerjs";
import { User, Users } from "./users";
import { ClientMessage, HostMessage, HostMessageType, ClientMessageType } from "./messages";
import { unreachable } from "./unreachable";
import { v4 as uuid } from "uuid";
import { P2PEvent } from "./p2p-event";
import { PromiseListener, resolvePromiseListeners, rejectPromiseListeners } from "./promise-utils";

export type EventHandler<TPayload> = (payload: TPayload, userId: string, createdDate: Date) => void;
export type Unsubscribe = () => void;

export interface SendEventManager<TPayload> {
    event: P2PEvent<TPayload>;
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
    event: P2PEvent<TPayload>;
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

export abstract class Peer<TUser extends User, TEventId> {
    public users = new Users<TUser>();
    public userId = uuid();
    public readonly options: Required<PeerOptions<TUser>>;

    protected peer?: PeerJS;
    protected events = new Map<string, EventMeta<any>>(); // eslint-disable-line
    protected pendingEvents = new Map<string, PendingEventManager<any>>(); // eslint-disable-line
    protected ignoredSerialIds = new Set<string>();
    protected sequenceNumber = 0;

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

    protected abstract sendClientMessage<TEventPayload>(message: ClientMessage<TUser, TEventPayload>): void;

    protected handleHostMessage<TEventPayload>(message: HostMessage<TUser, TEventPayload>): void {
        switch (message.messageType) {
            case HostMessageType.WELCOME:
                this.users.initialize(message.users);
                break;
            case HostMessageType.USER_CONNECTED:
                this.users.addUser(message.user);
                break;
            case HostMessageType.USER_DISCONNECTED:
                this.users.removeUser(message.userId);
                break;
            case HostMessageType.PING:
                this.sendClientMessage({
                    messageType: ClientMessageType.PONG,
                    initiationDate: message.initiationDate,
                    sequenceNumber: ++this.sequenceNumber,
                });
                break;
            case HostMessageType.RELAYED_EVENT:
                this.receivedEvent(message.event);
                break;
            case HostMessageType.ACKNOWLEDGED_BY_HOST:
                this.eventAcknowledgedByHost(message.serialId);
                break;
            case HostMessageType.ACKNOWLEDGED_BY_ALL:
                this.eventAcknowledgedByAll(message.serialId);
                break;
            case HostMessageType.PING_INFO:
                for (const { userId, ...pingInfo } of message.pingInfos) {
                    this.users.updatePingInfo(userId, pingInfo);
                }
                break;
            case HostMessageType.UPDATE_USER:
                this.users.updateUser(message.user.id, message.user);
                break;
            case HostMessageType.INCOMPATIBLE:
                throw new Error("Incompatible with host.");
                break;
            default:
                unreachable(message);
        }
    }

    private receivedEvent<TEventPayload>(event: P2PEvent<TEventPayload>): void {
        if (this.ignoredSerialIds.has(event.serialId)) {
            return;
        }
        this.sendClientMessage({
            messageType: ClientMessageType.ACKNOWLEDGE,
            serialId: event.serialId,
        });
        const eventManager = this.events.get(event.eventId);
        if (!eventManager) {
            throw new Error(`Received unknown event with id "${event.eventId}".`);
        }
        eventManager.subscriptions.forEach((subscription) =>
            subscription(event.payload, event.originUserId, new Date(event.createdDate)),
        );
    }

    private eventAcknowledgedByHost<TEventPayload>(serialId: string): void {
        if (this.ignoredSerialIds.has(serialId)) {
            return;
        }
        const pendingEvent = this.pendingEvents.get(serialId);
        if (!pendingEvent) {
            throw new Error(`Inconsistency detected. No pending event with serial id "${serialId}".`);
        }
        resolvePromiseListeners(Array.from(pendingEvent.waitForHostListeners.values()));
    }

    private eventAcknowledgedByAll<TEventPayload>(serialId: string): void {
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
            messageType: ClientMessageType.DISCONNECT,
        });
        this.peer.destroy();
    }

    protected async createLocalPeer(): Promise<PeerOpenResult> {
        await new Promise((resolve) => {
            this.peer = new PeerJS(null as any); // eslint-disable-line
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
        message: HostMessage<TUser, TEventPayload> | ClientMessage<TUser, TEventPayload>,
    ): void {
        connection.send(message);
    }

    protected sendEvent<TPayload>(eventId: string, payload: TPayload): P2PEvent<TPayload> {
        const event: P2PEvent<TPayload> = {
            eventId,
            originUserId: this.userId,
            payload,
            createdDate: Date.now(),
            serialId: uuid(),
        };
        setTimeout(() =>
            this.sendClientMessage({
                messageType: ClientMessageType.EVENT,
                event,
            }),
        );
        return event;
    }

    public ignoreSerialId(serialId: string): void {
        this.ignoredSerialIds.add(serialId);
    }
}
