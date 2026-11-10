// PRNG determinístico mulberry32 — idêntico ao SimulacaoCapability.Mulberry32 (Java) do backend.
// O seed (long no backend) é reduzido aos 32 bits baixos, como no Java ((int) seed).

export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = Number(BigInt.asIntN(32, BigInt(Math.trunc(seed))));
  }

  /** Real uniforme em [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Inteiro uniforme em [0, n). */
  nextInt(n: number): number {
    return Math.floor(this.next() * n);
  }
}
