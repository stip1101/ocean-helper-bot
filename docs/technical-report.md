# Ocean Helper Bot — Technical Report

## What It Is

Ocean Helper Bot is a Discord AI assistant that answers questions about oncompute.ai in real time. It uses OpenAI's GPT-5.4-mini model combined with a custom knowledge base built from oncompute.ai documentation. The knowledge base itself was prepared using Ocean Network's GPU compute infrastructure.


## How It Works

The system consists of two parts: a training pipeline that runs on Ocean Network GPU nodes, and a production Discord bot that handles user questions 24/7.

### Training Pipeline (Ocean Network)

The training pipeline is a Python compute job that runs on Ocean Network's H200 GPU nodes. Its purpose is to process all documentation from oncompute.ai into a format optimized for AI retrieval.

The pipeline goes through seven stages:

**1. Web Scraping** — The job fetches 8 pages from oncompute.ai and docs.oncompute.ai (homepage, FAQ, GPU compute page, products, Ocean Orchestrator, documentation index, getting started guide, and CLI reference). Each page is fetched with exponential backoff retry logic. HTML is cleaned using BeautifulSoup4 — navigation bars, footers, scripts, cookie banners, and other non-content elements are stripped out.

**2. Semantic Chunking** — The cleaned text is split into overlapping chunks of approximately 512 words each, with 128 words of overlap between consecutive chunks. Splitting happens at sentence boundaries to preserve semantic coherence. This is important because naive fixed-size splitting can cut sentences in half, degrading retrieval quality.

**3. Embedding Generation (GPU)** — Each chunk is converted into a 384-dimensional vector using the sentence-transformers/all-MiniLM-L6-v2 model running on GPU. Vectors are L2-normalized for cosine similarity search. GPU acceleration (H200) reduces this step from ~45 seconds on CPU to ~3 seconds.

**4. FAISS Index Construction** — A Facebook AI Similarity Search (FAISS) index is built from the embeddings. For the current dataset size (<1000 vectors), a flat inner product index is used. For larger datasets, the pipeline automatically switches to an IVF index with clustering.

**5. Q&A Pair Extraction** — The pipeline automatically identifies question-answer pairs from the FAQ page structure by detecting lines ending with "?" and collecting subsequent answer text. These pairs are used for retrieval quality benchmarking.

**6. Markdown Export** — The pipeline generates clean markdown files from the processed content, one per scraped page. Each file includes a metadata header (title, source URL, timestamp) followed by the cleaned text. These markdown files are the final knowledge base artifacts — they are uploaded directly to the OpenAI Vector Store that powers the bot's RAG retrieval. This step bridges the Ocean Network compute job with the production bot: the GPU pipeline processes and validates the content, and the output markdown files become the bot's live knowledge base.

**7. Retrieval Benchmarking** — 8 test queries are run against the FAISS index to measure retrieval quality before the knowledge base goes live. Each query returns the top 3 most relevant chunks with cosine similarity scores. The average top-1 score across all benchmark queries was 0.688, which indicates strong semantic matching between user questions and knowledge base content. This acts as a quality gate — if scores drop below threshold, the knowledge base update can be rejected.

All outputs (markdown knowledge base, chunks, embeddings, FAISS index, Q&A pairs, benchmark results, and pipeline metadata) are written to /data/outputs/ following Ocean Network's standard output convention. The markdown files in /data/outputs/knowledge/ are ready for direct upload to the OpenAI Vector Store.

### Production Bot

The production bot runs on a VPS as a Docker container with Redis for state management. When a user asks a question in the designated Discord channel, the following happens:

**1. Message Detection** — The bot monitors the configured channel for messages. It responds when directly mentioned (@Ocean Helper) or when it detects a question containing relevant keywords (gpu, compute, pricing, job, orchestrator, etc.).

**2. Security Checks** — Every message passes through a prompt guard that checks for injection attempts (22 patterns covering instruction override, role manipulation, jailbreak, and code execution attacks), offensive content, and Unicode homoglyph attacks (Cyrillic and Greek characters that look like Latin letters). Messages are sanitized — excessive whitespace is collapsed, code blocks are removed, and content is truncated to 1000 characters.

**3. Rate Limiting** — An atomic Redis + Lua script checks and increments the user's request count in a single operation. Each user is limited to 10 requests per 60-second window with a 5-second cooldown between messages. The rate limiter gracefully degrades if Redis is unavailable — it allows requests rather than blocking all users.

**4. Conversation Context** — The bot fetches the last 10 messages from the Discord channel to understand follow-up questions. Previous messages are formatted as a conversation log and prepended to the current question, allowing the AI to reference earlier context naturally.

**5. AI Response** — The sanitized question (with conversation context) is sent to OpenAI's Responses API using GPT-5.4-mini with the file_search tool. The file_search tool queries the Vector Store containing the processed oncompute.ai documentation. The system prompt instructs the model to give short, direct answers (2-3 sentences), never mention internal documents, and respond in the user's language.

**6. Response Delivery** — The AI response is truncated to Discord's 2000-character limit if necessary and sent as a reply to the user's message.


## Knowledge Base Content

The knowledge base covers the following topics scraped from oncompute.ai:

- Platform overview (what Ocean Network is, how decentralized compute works)
- GPU compute offerings (H200 pricing, available resources)
- Getting started (how to run first job, claim grant tokens)
- Ocean Orchestrator (IDE integration with VS Code, Cursor, Windsurf, Antigravity)
- Products (Ocean Nodes vs Ocean Orchestrator)
- FAQ (common questions about jobs, supported languages, payments)
- CLI reference (ocean-cli commands for programmatic job submission)
- Documentation index (links to detailed guides)

Administrators can refresh the knowledge base at any time using the /knowledge refresh slash command, which re-scrapes all pages and re-uploads to the Vector Store without any bot downtime.


## Admin Controls

The bot provides slash commands for administrators:

- /aihelper status — shows current configuration (model, rate limits, context settings, vector store)
- /aihelper enable / disable — toggle the bot on or off globally
- /aihelper reset-limit @user — reset rate limit for a specific user
- /aihelper temp-info add "text" — inject temporary information into AI responses (useful for announcements without redeploying)
- /aihelper temp-info remove / list — manage temporary info entries
- /knowledge refresh — re-scrape oncompute.ai and update the knowledge base
- /knowledge status — show vector store file count, size, and expiration


## Tech Stack

The training pipeline uses Python with sentence-transformers, FAISS, BeautifulSoup4, and NumPy, running on Ocean Network H200 GPU nodes.

The production bot uses Bun (TypeScript runtime), discord.js v14, OpenAI API (GPT-5.4-mini with Responses API and Vector Stores), Redis for state management, and cheerio for ongoing web scraping. It runs in Docker with multi-stage builds, non-root user, dumb-init for signal handling, and health checks.


## Testing

The codebase includes 44 unit tests covering prompt guard (injection detection, offensive content filtering, Unicode homoglyph attacks, ReDoS resistance, message sanitization), rate limiter (atomic slot acquisition, cooldown management, graceful degradation, user ID validation), and conversation context (message fetching, formatting, error handling).
