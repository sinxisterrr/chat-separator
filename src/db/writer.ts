//--------------------------------------------------------------
// FILE: src/db/writer.ts
// Database writer for Continuum Parser → Postgres with pgvector
//--------------------------------------------------------------

import pg from "pg";
import { PersonaBlock, ArchivalMemoryItem } from "../types/memory.js";

const { Pool } = pg;

export interface DatabaseConfig {
  connectionString: string;
}

export class DatabaseWriter {
  private pool: pg.Pool;

  constructor(config: DatabaseConfig) {
    this.pool = new Pool({
      connectionString: config.connectionString,
      ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
    });
  }

  async initialize(): Promise<void> {
    const client = await this.pool.connect();
    try {
      // Enable pgvector extension
      await client.query("CREATE EXTENSION IF NOT EXISTS vector");

      // Create persona_blocks table
      await client.query(`
        CREATE TABLE IF NOT EXISTS persona_blocks (
          id SERIAL PRIMARY KEY,
          label TEXT NOT NULL,
          block_type TEXT NOT NULL,
          content TEXT NOT NULL,
          description TEXT,
          mira_type TEXT,
          message_count INTEGER,
          average_weight NUMERIC,
          min_weight NUMERIC,
          max_weight NUMERIC,
          embedding vector(384),
          metadata JSONB,
          created_at TIMESTAMP DEFAULT NOW()
        )
      `);

      // Create human_blocks table
      await client.query(`
        CREATE TABLE IF NOT EXISTS human_blocks (
          id SERIAL PRIMARY KEY,
          label TEXT NOT NULL,
          block_type TEXT NOT NULL,
          content TEXT NOT NULL,
          description TEXT,
          mira_type TEXT,
          message_count INTEGER,
          average_weight NUMERIC,
          min_weight NUMERIC,
          max_weight NUMERIC,
          embedding vector(384),
          metadata JSONB,
          created_at TIMESTAMP DEFAULT NOW()
        )
      `);

      // Create archival_memories table
      await client.query(`
        CREATE TABLE IF NOT EXISTS archival_memories (
          id TEXT PRIMARY KEY,
          content TEXT NOT NULL,
          category TEXT NOT NULL,
          importance INTEGER NOT NULL,
          timestamp BIGINT,
          tags TEXT[],
          mira_type TEXT,
          message_weight NUMERIC,
          embedding vector(384),
          metadata JSONB,
          created_at TIMESTAMP DEFAULT NOW()
        )
      `);

      // Create indexes for vector similarity search
      await client.query(`
        CREATE INDEX IF NOT EXISTS persona_blocks_embedding_idx
        ON persona_blocks USING ivfflat (embedding vector_cosine_ops)
        WITH (lists = 100)
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS human_blocks_embedding_idx
        ON human_blocks USING ivfflat (embedding vector_cosine_ops)
        WITH (lists = 100)
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS archival_memories_embedding_idx
        ON archival_memories USING ivfflat (embedding vector_cosine_ops)
        WITH (lists = 100)
      `);

      console.log("✅ Database tables and indexes created successfully");
    } finally {
      client.release();
    }
  }

  async writePersonaBlocks(blocks: PersonaBlock[], embeddings: number[][]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i];
        const embedding = embeddings[i];

        await client.query(
          `INSERT INTO persona_blocks
           (label, block_type, content, description, mira_type, message_count,
            average_weight, min_weight, max_weight, embedding, metadata)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            block.label,
            block.block_type,
            block.content,
            block.description,
            block.metadata?.miraType,
            block.metadata?.count,
            block.metadata?.averageWeight,
            block.metadata?.minWeight,
            block.metadata?.maxWeight,
            JSON.stringify(embedding),
            block.metadata,
          ]
        );
      }

      await client.query("COMMIT");
      console.log(`✅ Inserted ${blocks.length} persona blocks`);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async writeHumanBlocks(blocks: PersonaBlock[], embeddings: number[][]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i];
        const embedding = embeddings[i];

        await client.query(
          `INSERT INTO human_blocks
           (label, block_type, content, description, mira_type, message_count,
            average_weight, min_weight, max_weight, embedding, metadata)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            block.label,
            block.block_type,
            block.content,
            block.description,
            block.metadata?.miraType,
            block.metadata?.count,
            block.metadata?.averageWeight,
            block.metadata?.minWeight,
            block.metadata?.maxWeight,
            JSON.stringify(embedding),
            block.metadata,
          ]
        );
      }

      await client.query("COMMIT");
      console.log(`✅ Inserted ${blocks.length} human blocks`);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async writeArchivalMemories(
    memories: ArchivalMemoryItem[],
    embeddings: number[][]
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      for (let i = 0; i < memories.length; i++) {
        const memory = memories[i];
        const embedding = embeddings[i];

        // DEBUG: Check if content is actually present
        if (!memory.content) {
          console.warn(`⚠️  WARNING: Memory ${i} (id: ${memory.id}) has null/empty content!`);
          console.warn(`   Memory object:`, JSON.stringify(memory, null, 2));
        } else if (i < 3) {
          // Log first 3 for verification
          console.log(`✓ Memory ${i}: content="${memory.content.substring(0, 50)}..." (${memory.content.length} chars)`);
        }

        // Add source tracking to metadata
        const metadataWithSource = {
          ...memory.metadata,
          source: 'parser',
          parsed_at: new Date().toISOString()
        };

        await client.query(
          `INSERT INTO archival_memories
           (id, content, category, importance, timestamp, tags, mira_type,
            message_weight, embedding, metadata)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (id) DO UPDATE SET
           content = EXCLUDED.content,
           category = EXCLUDED.category,
           importance = EXCLUDED.importance,
           embedding = EXCLUDED.embedding,
           metadata = EXCLUDED.metadata`,
          [
            memory.id,
            memory.content,
            memory.category,
            memory.importance,
            memory.timestamp,
            memory.tags,
            memory.metadata?.miraType,
            memory.metadata?.weight,
            JSON.stringify(embedding),
            metadataWithSource,
          ]
        );
      }

      await client.query("COMMIT");
      console.log(`✅ Inserted ${memories.length} archival memories`);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
