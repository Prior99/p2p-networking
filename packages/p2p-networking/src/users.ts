import { UserInfo, User, PingInfo } from "./types";
import { InternalError } from "./utils";

export class Users<TUser extends User> {
    private users = new Map<string, UserInfo<TUser>>();

    public addUser(user: TUser): void {
        this.users.set(user.id, {
            user,
            lastPingDate: Date.now(),
            roundTripTime: undefined,
        });
    }

    public removeUser(userId: string): void {
        this.users.delete(userId);
    }

    public getUser(userId: string): TUser | undefined {
        return this.users.get(userId)?.user;
    }

    public updateUser(userId: string, update: Omit<Partial<TUser>, "id">): void {
        const userInfo = this.users.get(userId);
        /* istanbul ignore if */
        if (!userInfo) {
            throw new InternalError(`No user with id "${userId}".`);
        }
        this.users.set(userId, {
            ...userInfo,
            user: {
                ...userInfo.user,
                ...update,
            },
        });
    }

    public updatePingInfo(userId: string, update: Partial<PingInfo>): void {
        const userInfo = this.users.get(userId);
        /* istanbul ignore if */
        if (!userInfo) {
            throw new InternalError(`No user with id "${userId}".`);
        }
        this.users.set(userId, {
            ...userInfo,
            ...update,
        });
    }

    public initialize(users: UserInfo<TUser>[]): void {
        for (const { user, lastPingDate, roundTripTime } of users) {
            this.addUser(user);
            this.updatePingInfo(user.id, { lastPingDate, roundTripTime });
        }
    }

    public get allUsers(): TUser[] {
        return this.all.map(({ user }) => user);
    }

    public get all(): UserInfo<TUser>[] {
        return Array.from(this.users.values()).sort((a, b) => a.user.id.localeCompare(b.user.id));
    }

    public get count(): number {
        return this.users.size;
    }
}