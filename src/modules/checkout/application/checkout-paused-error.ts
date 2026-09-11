export class CheckoutPausedError extends Error {
  constructor() {
    super("ただいま新しいご注文の受付を一時停止しています。時間をおいてもう一度お試しください。");
    this.name = "CheckoutPausedError";
  }
}
