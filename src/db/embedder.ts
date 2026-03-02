//--------------------------------------------------------------
// FILE: src/db/embedder.ts
// Client for embedding service
//--------------------------------------------------------------

export interface EmbedderConfig {
  url: string;
}

export class EmbeddingClient {
  private url: string;

  constructor(config: EmbedderConfig) {
    this.url = config.url;
    console.log(`🔗 Embedding client initialized with URL: ${this.url}`);
  }

  async embedBatch(texts: string[], batchSize = 100): Promise<number[][]> {
    if (texts.length === 0) {
      console.log(`⚠️  embedBatch called with 0 texts, skipping...`);
      return [];
    }

    console.log(`📤 Embedding ${texts.length} texts in batches of ${batchSize}...`);

    const allEmbeddings: number[][] = [];

    // Process in chunks to avoid payload size issues
    for (let i = 0; i < texts.length; i += batchSize) {
      const chunk = texts.slice(i, i + batchSize);
      const chunkNum = Math.floor(i / batchSize) + 1;
      const totalChunks = Math.ceil(texts.length / batchSize);

      console.log(`   Batch ${chunkNum}/${totalChunks} (${chunk.length} texts)...`);

      try {
        const response = await fetch(`${this.url}/embed/batch`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ texts: chunk }),
        });

        if (!response.ok) {
          const error = await response.text();
          throw new Error(`Embedder error: ${response.status} - ${error}`);
        }

        const result = await response.json();
        allEmbeddings.push(...result.embeddings);
        console.log(`   ✅ Batch ${chunkNum}/${totalChunks} complete (${result.count} embeddings)`);
      } catch (err: any) {
        console.error(`❌ Failed to embed batch ${chunkNum}/${totalChunks}: ${err.message}`);
        throw err;
      }
    }

    console.log(`✅ All embeddings complete: ${allEmbeddings.length} total`);
    return allEmbeddings;
  }

  async checkHealth(): Promise<boolean> {
    try {
      console.log(`🏥 Checking embedder health at ${this.url}/health`);
      const response = await fetch(`${this.url}/health`);
      if (!response.ok) {
        console.error(`❌ Health check failed: ${response.status}`);
        return false;
      }

      const health = await response.json();
      console.log(
        `💓 Embedder health: ${health.status} (model: ${health.model}, ${health.dimensions}D)`
      );
      return health.ready;
    } catch (err: any) {
      console.error(`❌ Health check error: ${err.message}`);
      return false;
    }
  }
}
