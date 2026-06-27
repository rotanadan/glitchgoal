/**
 * Q16.16 fixed-point arithmetic.
 *
 * Rollback netcode requires bit-identical simulation across machines. JS floats
 * (IEEE-754 doubles) are deterministic *per operation*, but it is far too easy
 * to introduce divergence (e.g. Math.* intrinsics, transcendental functions,
 * subnormals). Integer fixed-point sidesteps the whole class of problems: every
 * value is a 32-bit-range integer and every op is integer math.
 *
 * A Fixed value is a plain `number` holding an integer = realValue * 2^16.
 * We brand it so the type system stops us mixing raw numbers with fixed values.
 */

export type Fixed = number & { readonly __fixed: unique symbol };

export const SHIFT = 16;
export const ONE: Fixed = (1 << SHIFT) as Fixed;
export const ZERO: Fixed = 0 as Fixed;
export const HALF: Fixed = (1 << (SHIFT - 1)) as Fixed;

/** Construct a Fixed from an integer. */
export function fromInt(n: number): Fixed {
  return ((n | 0) << SHIFT) as Fixed;
}

/**
 * Construct a Fixed from a float. ONLY for authoring constants / converting
 * input at the edge — never inside the per-frame sim loop, where determinism
 * matters. Rounds to nearest.
 */
export function fromFloat(n: number): Fixed {
  return Math.round(n * (1 << SHIFT)) as Fixed;
}

/** Convert to float. ONLY for rendering / debug — never feeds back into sim. */
export function toFloat(a: Fixed): number {
  return a / (1 << SHIFT);
}

/** Truncate toward zero to an integer. */
export function toInt(a: Fixed): number {
  return a >> SHIFT;
}

export function add(a: Fixed, b: Fixed): Fixed {
  return ((a + b) | 0) as Fixed;
}

export function sub(a: Fixed, b: Fixed): Fixed {
  return ((a - b) | 0) as Fixed;
}

export function neg(a: Fixed): Fixed {
  return (-a | 0) as Fixed;
}

/**
 * Multiply. Uses the BigInt path to keep full precision of the intermediate
 * 64-bit product before shifting back down — a plain `(a*b)>>SHIFT` overflows
 * 53-bit float mantissa for large operands and would diverge.
 */
export function mul(a: Fixed, b: Fixed): Fixed {
  return Number((BigInt(a) * BigInt(b)) >> BigInt(SHIFT)) as Fixed;
}

/** Divide. */
export function div(a: Fixed, b: Fixed): Fixed {
  return Number((BigInt(a) << BigInt(SHIFT)) / BigInt(b)) as Fixed;
}

export function abs(a: Fixed): Fixed {
  return (a < 0 ? -a : a) as Fixed;
}

export function min(a: Fixed, b: Fixed): Fixed {
  return (a < b ? a : b) as Fixed;
}

export function max(a: Fixed, b: Fixed): Fixed {
  return (a > b ? a : b) as Fixed;
}

export function clamp(a: Fixed, lo: Fixed, hi: Fixed): Fixed {
  return a < lo ? lo : a > hi ? hi : a;
}

/**
 * Integer square root of a Fixed, returning a Fixed. Deterministic across
 * machines (pure integer Newton/bit method via BigInt). Needed for vector
 * magnitudes in collision response.
 */
export function sqrt(a: Fixed): Fixed {
  if (a <= 0) return ZERO;
  // value = a / 2^16; sqrt(value) * 2^16 = sqrt(a * 2^16).
  const n = BigInt(a) << BigInt(SHIFT);
  let x = n;
  let y = (x + 1n) >> 1n;
  while (y < x) {
    x = y;
    y = (x + n / x) >> 1n;
  }
  return Number(x) as Fixed;
}
