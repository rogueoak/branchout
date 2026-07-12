// Ambient types for poly-decomp (0.3.0), which ships no TypeScript declarations. We only need the
// module to exist as an opaque value to hand to Matter's `Common.setDecomp` for concave-shape
// decomposition; the decomposition math itself is invoked by matter-js, not by us. Keeping this
// minimal (an opaque namespace with the functions Matter probes for) avoids over-modeling a library
// we never call directly.
declare module 'poly-decomp' {
  const decomp: {
    decomp: (polygon: number[][]) => number[][][] | false;
    quickDecomp: (polygon: number[][]) => number[][][];
    isSimple: (polygon: number[][]) => boolean;
    removeCollinearPoints: (polygon: number[][], precision?: number) => number;
    removeDuplicatePoints: (polygon: number[][], precision?: number) => void;
    makeCCW: (polygon: number[][]) => boolean;
  };
  export default decomp;
}
