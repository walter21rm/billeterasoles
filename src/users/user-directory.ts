export abstract class UserDirectory {
  abstract requireActive(userId: number): Promise<void>;
}
