import { paths } from "../paths.js";
import type { EmbeddingProvider } from "./provider.js";

type Extractor = (
  texts: string[],
  opts: { pooling: "cls" | "mean"; normalize: boolean },
) => Promise<{ tolist(): number[][] }>;

/** bge-* models want this prefix on queries only; other models are used as-is. */
function queryPrefix(model: string): string {
  return /bge-/i.test(model) ? "Represent this sentence for searching relevant passages: " : "";
}

/**
 * Local ONNX embeddings via @huggingface/transformers. The model (~35 MB for
 * bge-small q8) is downloaded once into ~/.eminiar/models and cached there.
 */
export class TransformersProvider implements EmbeddingProvider {
  private extractor: Extractor | undefined;
  private loading: Promise<Extractor> | undefined;
  private loadError: string | undefined;

  constructor(
    readonly model: string,
    readonly dims: number,
  ) {}

  ready(): boolean {
    return !!this.extractor;
  }

  error(): string | undefined {
    return this.loadError;
  }

  warm(): void {
    void this.load().catch(() => undefined);
  }

  private load(): Promise<Extractor> {
    if (this.extractor) return Promise.resolve(this.extractor);
    if (!this.loading) {
      this.loading = (async () => {
        const tf = await import("@huggingface/transformers");
        tf.env.cacheDir = paths().models;
        tf.env.allowLocalModels = true;
        const pipe = (await tf.pipeline("feature-extraction", this.model, {
          dtype: "q8",
          device: "cpu",
        })) as unknown as Extractor;
        this.extractor = pipe;
        return pipe;
      })().catch((err) => {
        this.loadError = (err as Error).message;
        this.loading = undefined;
        throw err;
      });
    }
    return this.loading;
  }

  async embed(texts: string[], kind: "query" | "passage"): Promise<Float32Array[]> {
    if (!texts.length) return [];
    const extractor = await this.load();
    const prefix = kind === "query" ? queryPrefix(this.model) : "";
    const pooling = /bge-/i.test(this.model) ? "cls" : "mean";
    const out: Float32Array[] = [];
    // Keep batches small: q8 CPU inference on long chunks is memory-hungry.
    for (let i = 0; i < texts.length; i += 16) {
      const batch = texts.slice(i, i + 16).map((t) => prefix + t.slice(0, 2000));
      const res = await extractor(batch, { pooling, normalize: true });
      for (const row of res.tolist()) out.push(Float32Array.from(row));
    }
    return out;
  }
}
