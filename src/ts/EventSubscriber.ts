import {
  DefaultListener,
  ListenerSignature,
  TypedEmitter,
} from 'tiny-typed-emitter';

type AnyFunc = (...args: any[]) => void;

interface Subscription<F> {
  count: number;
  proxy: F;
}

type Subs<L, E extends keyof L> = Map<L[E], Subscription<L[E]>>;

type EventSubs<L> = Map<keyof L, Subs<L, keyof L>>;

// L is not inferred, don't know why
export class EventSubscriber<L extends ListenerSignature<L> = DefaultListener> {
  private eventSubs: EventSubs<L> = new Map();

  constructor(public emitter: TypedEmitter<L>) {}

  on<E extends keyof L>(event: E, listener: L[E]) {
    const proxy = listener;
    this.incSub(event, listener, proxy);
  }

  once<E extends keyof L>(event: E, listener: L[E]) {
    const proxy = ((...args: any[]) => {
      this.decSub(event, listener);
      return listener(args);
    }) as any;
    this.incSub(event, listener, proxy);
  }

  off<E extends keyof L>(event?: E, listener?: L[E]) {
    if (event !== undefined && !this.eventSubs.has(event)) return;
    const subsEntries: [keyof L, Subs<L, keyof L> | undefined][] = event
      ? [[event, this.eventSubs.get(event)]]
      : [...this.eventSubs.entries()];

    for (const [event, subs] of subsEntries) {
      if (!subs) continue;

      let subEntries: [L[keyof L], Subscription<L[keyof L]> | undefined][] =
        listener ? [[listener, subs.get(listener)]] : [...subs.entries()];

      for (const [l, _] of subEntries) {
        this.decSub(event, l);
      }
    }
  }

  // proxy is cached for multiple subs on the same event & listener
  private incSub<E extends keyof L>(event: E, listener: L[E], proxy: L[E]) {
    const subs: Subs<L, E> = this.eventSubs.get(event) ?? new Map();
    const sub = subs.get(listener) ?? { count: 0, proxy };
    sub.count++;
    subs.set(listener, sub);
    this.eventSubs.set(event, subs);

    this.emitter.on(event, sub.proxy);
  }

  private decSub<E extends keyof L>(event: E, listener: L[E]) {
    const subs = this.eventSubs.get(event);
    if (!subs) return;
    const sub = subs.get(listener);
    if (!sub) return;
    if (--sub.count <= 0) {
      subs.delete(listener);
    }

    this.emitter.off(event, sub.proxy);
  }
}
