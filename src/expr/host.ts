/**
 * Host values — the only bridge between the interpreter and anything that is
 * not plain data.
 *
 * A DOM element, an Event, a `classList`, a frozen intrinsic namespace and a
 * runtime magic function all reach expressions ONLY as a `Host`: a branded,
 * frozen wrapper carrying a KIND. The interpreter dispatches on that kind
 * against a table in allowlist.ts, so there is no code path where an expression
 * holds a raw DOM node, a raw Event or a raw intrinsic.
 *
 * That is what closes the `$refs` escape: before this module, `$refs.panel`
 * handed back the real element and `$refs.panel.ownerDocument.location.href`
 * read the page URL with no diagnostic.
 * Verified by: src/expr/__tests__/adversarial.test.ts > "$refs.r.ownerDocument.location.href is denied"
 *
 * The brand is a Symbol, so untrusted JSON (threat T2) cannot forge one: JSON
 * has no symbol keys.
 * Verified by: src/expr/__tests__/adversarial.test.ts > "a JSON object cannot forge a host value"
 */

const HOST = Symbol.for('forma.expr.host');

export type HostKind =
  /** A DOM element, reachable only through the element property allowlist. */
  | 'element'
  /** A DOM Event, reachable only through the event property allowlist. */
  | 'event'
  /** `element.classList`. */
  | 'classList'
  /** `element.style` (CSSOM writes — never a `style` attribute string). */
  | 'style'
  /** `element.dataset`. */
  | 'dataset'
  /** The `$refs` map: name → element host, or `undefined` for an absent ref. */
  | 'refs'
  /** A frozen table of captured intrinsics (`Math`, `JSON`, `Object`, …). */
  | 'namespace'
  /** A single captured callable (`parseInt`, `$dispatch`, `Number`, …). */
  | 'fn';

export interface Host {
  readonly kind: HostKind;
  readonly label: string;
  /** The wrapped element / event / DOM sub-object / function. */
  readonly target: unknown;
  /** Named members, for `namespace` and for functions that carry statics. */
  readonly members?: Readonly<Record<string, unknown>>;
  /** Maximum arguments forwarded to a `fn` target. */
  readonly maxArgs: number;
  /**
   * The tiered mount this host was made under, if any (FORMA-128). Every host
   * derived from it carries the same bound, so the wrapper survives every hop.
   */
  readonly bound?: Bound;
}

/** A grant an expression can need; the runtime checks `fetch` itself. */
export type ExprGrant = 'dom' | 'navigate';

/**
 * What an element host made under a tiered mount may reach (L-36): only the
 * mount root's descendants, unless the mount grants `dom`, and `click()` only
 * with `navigate`. The runtime makes one per mount; the interpreter checks it
 * on every hop that yields an element and on every call that needs a grant.
 */
export interface Bound {
  /** The mount root. Not itself inside the mount: it is the application's element. */
  readonly root: Node;
  /** Whether the mount grants `dom`, the page beyond its root. */
  readonly dom: boolean;
  /** Whether the mount grants `navigate`. */
  readonly navigate: boolean;
  /**
   * Called when an operation needed a grant and the mount had it, for the
   * development report of the grants each mount used. A no-op in production.
   */
  readonly use: (grant: ExprGrant) => void;
}

interface BrandedHost extends Host {
  readonly [HOST]: true;
}

function brand(host: Host): Host {
  return Object.freeze({ ...host, [HOST]: true } as BrandedHost);
}

/**
 * Freeze a member table onto a NULL prototype.
 *
 * Lookups already go through `Object.hasOwn`, so inheritance would not have
 * been readable — but a table whose prototype is `Object.prototype` is not the
 * "frozen, null-prototype, interpreter-owned table" the security model
 * describes, and a claim that is only true because a caller elsewhere is
 * careful is the kind that stops being true.
 * Verified by: src/expr/__tests__/allowlist-snapshot.test.ts > "every global namespace is a frozen, null-prototype table of captured intrinsics"
 */
function sealedTable(members: Record<string, unknown>): Readonly<Record<string, unknown>> {
  return Object.freeze(
    Object.assign(Object.create(null) as Record<string, unknown>, members),
  );
}

/**
 * Wrap a DOM-side object. `target` is never exposed to expressions directly.
 * `bound` is the tiered mount it was made under, if any.
 */
export function hostObject(
  kind: Exclude<HostKind, 'namespace' | 'fn'>,
  target: unknown,
  label: string,
  bound?: Bound,
): Host {
  return brand(bound ? { kind, label, target, maxArgs: 0, bound } : { kind, label, target, maxArgs: 0 });
}

/** Wrap a frozen, null-prototype table of captured intrinsics. */
export function hostNamespace(label: string, members: Record<string, unknown>): Host {
  return brand({ kind: 'namespace', label, target: null, members: sealedTable(members), maxArgs: 0 });
}

/** Wrap a captured callable. `members` carries its allowlisted statics, if any. */
export function hostFn(
  label: string,
  fn: (...args: never[]) => unknown,
  maxArgs: number,
  members?: Record<string, unknown>,
): Host {
  return brand({
    kind: 'fn',
    label,
    target: fn,
    members: members ? sealedTable(members) : undefined,
    maxArgs,
  });
}

/** True only for values this module branded. */
export function isHost(v: unknown): v is Host {
  return (
    typeof v === 'object'
    && v !== null
    && (v as Record<symbol, unknown>)[HOST] === true
  );
}
