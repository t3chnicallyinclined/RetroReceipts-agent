/* tslint:disable */
/* eslint-disable */

export class WebFeed {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * The FrameRecord of tape row `i` (empty when out of range).
     */
    frame(i: number): Uint8Array;
    frame_count(): number;
    info(): string;
    /**
     * `pack_index_json` = `[{"name": "chars/PL2A_idx.png", "off": 0, "len": 123}, ...]` into `pack_blob`;
     * `opts_json` = a subset of EmitOpts fields ({"no_world": bool, "no_preamble": bool, "pal_lag": n, "bank": n, "no_palrow_resolve": bool}).
     */
    constructor(tape: Uint8Array, pack_index_json: string, pack_blob: Uint8Array, opts_json: string);
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_webfeed_free: (a: number, b: number) => void;
    readonly webfeed_frame: (a: number, b: number) => [number, number];
    readonly webfeed_frame_count: (a: number) => number;
    readonly webfeed_info: (a: number) => [number, number];
    readonly webfeed_new: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number, number];
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
