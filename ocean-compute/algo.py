import subprocess
import sys

def install_deps():
    packages = [
        "requests", "beautifulsoup4", "sentence-transformers",
        "faiss-cpu", "numpy", "tqdm",
    ]
    for pkg in packages:
        subprocess.check_call([sys.executable, "-m", "pip", "install", "-q", pkg])

install_deps()

import os
import re
import json
import time
import hashlib
import requests
import numpy as np
from datetime import datetime
from bs4 import BeautifulSoup

# ==========================================
# OnCompute AI Helper — Knowledge Base Pipeline
# Runs on Ocean Network GPU nodes
#
# Scrapes oncompute.ai docs, builds semantic
# embeddings and FAISS index for RAG search.
# ==========================================

PAGES = [
    {"url": "https://www.oncompute.ai/", "name": "homepage"},
    {"url": "https://www.oncompute.ai/faq", "name": "faq"},
    {"url": "https://www.oncompute.ai/gpu-compute", "name": "gpu-compute"},
    {"url": "https://www.oncompute.ai/products", "name": "products"},
    {"url": "https://www.oncompute.ai/ocean-orchestrator", "name": "ocean-orchestrator"},
    {"url": "https://docs.oncompute.ai/", "name": "docs-main"},
    {"url": "https://docs.oncompute.ai/getting-started", "name": "docs-getting-started"},
    {"url": "https://docs.oncompute.ai/ocean-cli", "name": "docs-cli"},
]

EMBEDDING_MODEL = os.environ.get("EMBEDDING_MODEL", "all-MiniLM-L6-v2")
CHUNK_SIZE = int(os.environ.get("CHUNK_SIZE", "512"))
CHUNK_OVERLAP = int(os.environ.get("CHUNK_OVERLAP", "128"))
BATCH_SIZE = int(os.environ.get("BATCH_SIZE", "64"))
HTTP_TIMEOUT = 15
HTTP_RETRIES = 3

OUTPUT_DIR = "/data/outputs" if os.path.exists("/data") else "./data/outputs"

BENCHMARK_QUERIES = [
    "How do I run a GPU compute job?",
    "What is the pricing for H200 GPUs?",
    "How to use the Ocean CLI?",
    "What is Ocean Orchestrator?",
    "How to deploy a container on oncompute?",
    "What IDEs are supported?",
    "How does the escrow payment work?",
    "Can I fine-tune models on oncompute?",
]


def setup_device():
    try:
        import torch
        if torch.cuda.is_available():
            device_name = torch.cuda.get_device_name(0)
            vram = torch.cuda.get_device_properties(0).total_memory / (1024 ** 3)
            print(f"GPU detected: {device_name} ({vram:.1f} GB VRAM)")
            return "cuda"
        else:
            print("No GPU available, falling back to CPU")
            return "cpu"
    except ImportError:
        print("PyTorch not found, using CPU")
        return "cpu"


def fetch_page(url, retries=HTTP_RETRIES):
    headers = {
        "User-Agent": "OnComputeBot/1.0 (Knowledge Base Pipeline)",
        "Accept": "text/html",
    }
    for attempt in range(retries):
        try:
            resp = requests.get(url, headers=headers, timeout=HTTP_TIMEOUT)
            resp.raise_for_status()
            return resp.text
        except requests.RequestException as e:
            if attempt < retries - 1:
                wait = 2 ** attempt
                print(f"  Retry {attempt + 1}/{retries} for {url} in {wait}s ({e})")
                time.sleep(wait)
            else:
                print(f"  FAILED: {url} after {retries} attempts ({e})")
                return None


def extract_text(html):
    soup = BeautifulSoup(html, "html.parser")

    for tag in soup(["script", "style", "nav", "footer", "header",
                     "iframe", "noscript", "svg", "img"]):
        tag.decompose()

    for cls in ["cookie-banner", "popup", "modal", "sidebar", "menu"]:
        for el in soup.find_all(class_=re.compile(cls, re.I)):
            el.decompose()

    main = soup.find("main") or soup.find("article") or soup.find(role="main")
    if main:
        raw = main.get_text(separator="\n")
    else:
        raw = soup.body.get_text(separator="\n") if soup.body else ""

    lines = []
    for line in raw.split("\n"):
        stripped = line.strip()
        if stripped and len(stripped) > 2:
            lines.append(stripped)

    return "\n".join(lines)


def extract_title(html):
    soup = BeautifulSoup(html, "html.parser")
    if soup.title and soup.title.string:
        return soup.title.string.strip()
    h1 = soup.find("h1")
    if h1:
        return h1.get_text(strip=True)
    return ""


def scrape_pages():
    print(f"\n{'='*50}")
    print(f"Scraping {len(PAGES)} pages from oncompute.ai")
    print(f"{'='*50}")

    documents = []
    failed = 0

    for page in PAGES:
        print(f"\n  [{page['name']}] {page['url']}")
        html = fetch_page(page["url"])
        if not html:
            failed += 1
            continue

        text = extract_text(html)
        title = extract_title(html)

        if len(text) < 50:
            print(f"  Skipped — too little content ({len(text)} chars)")
            failed += 1
            continue

        doc = {
            "name": page["name"],
            "url": page["url"],
            "title": title,
            "text": text,
            "char_count": len(text),
            "scraped_at": datetime.utcnow().isoformat(),
        }
        documents.append(doc)
        print(f"  OK — {len(text)} chars, title: \"{title[:60]}\"")

    print(f"\nScraped {len(documents)}/{len(PAGES)} pages ({failed} failed)")
    return documents


def chunk_text(text, chunk_size=CHUNK_SIZE, overlap=CHUNK_OVERLAP):
    """Split text into overlapping chunks at sentence boundaries."""
    sentences = re.split(r'(?<=[.!?])\s+', text)

    chunks = []
    current = []
    current_len = 0

    for sent in sentences:
        sent_len = len(sent.split())
        if current_len + sent_len > chunk_size and current:
            chunks.append(" ".join(current))
            overlap_sents = []
            overlap_len = 0
            for s in reversed(current):
                s_len = len(s.split())
                if overlap_len + s_len > overlap:
                    break
                overlap_sents.insert(0, s)
                overlap_len += s_len
            current = overlap_sents
            current_len = overlap_len

        current.append(sent)
        current_len += sent_len

    if current:
        chunks.append(" ".join(current))

    return chunks


def chunk_documents(documents):
    print(f"\n{'='*50}")
    print(f"Chunking documents (size={CHUNK_SIZE}, overlap={CHUNK_OVERLAP})")
    print(f"{'='*50}")

    all_chunks = []
    for doc in documents:
        chunks = chunk_text(doc["text"])
        for i, chunk in enumerate(chunks):
            chunk_id = hashlib.md5(f"{doc['name']}:{i}:{chunk[:100]}".encode()).hexdigest()[:12]
            all_chunks.append({
                "id": chunk_id,
                "source": doc["name"],
                "url": doc["url"],
                "chunk_index": i,
                "text": chunk,
                "word_count": len(chunk.split()),
            })
        print(f"  {doc['name']}: {len(chunks)} chunks")

    word_counts = [c["word_count"] for c in all_chunks]
    print(f"\nTotal chunks: {len(all_chunks)}")
    print(f"Avg words/chunk: {np.mean(word_counts):.0f} (min={min(word_counts)}, max={max(word_counts)})")

    return all_chunks


def generate_embeddings(chunks, device="cpu"):
    from sentence_transformers import SentenceTransformer

    print(f"\n{'='*50}")
    print(f"Generating embeddings with {EMBEDDING_MODEL} on {device}")
    print(f"{'='*50}")

    model = SentenceTransformer(EMBEDDING_MODEL, device=device)

    texts = [c["text"] for c in chunks]
    embeddings = model.encode(
        texts,
        batch_size=BATCH_SIZE,
        show_progress_bar=True,
        convert_to_numpy=True,
        normalize_embeddings=True,
    )

    dim = embeddings.shape[1]
    print(f"\nEmbeddings: {embeddings.shape[0]} vectors, dim={dim}")
    print(f"Memory: {embeddings.nbytes / (1024*1024):.2f} MB")

    return embeddings, dim


def build_faiss_index(embeddings, dim):
    import faiss

    print(f"\n{'='*50}")
    print(f"Building FAISS index (dim={dim})")
    print(f"{'='*50}")

    n = embeddings.shape[0]

    if n < 1000:
        index = faiss.IndexFlatIP(dim)
        print(f"Using IndexFlatIP (flat, {n} vectors)")
    else:
        nlist = min(int(np.sqrt(n)), 100)
        quantizer = faiss.IndexFlatIP(dim)
        index = faiss.IndexIVFFlat(quantizer, dim, nlist, faiss.METRIC_INNER_PRODUCT)
        index.train(embeddings)
        print(f"Using IndexIVFFlat (nlist={nlist}, {n} vectors)")

    index.add(embeddings)
    print(f"Index built: {index.ntotal} vectors")

    return index


def extract_qa_pairs(documents):
    """Pull Q&A pairs from FAQ page structure."""
    print(f"\n{'='*50}")
    print("Extracting Q&A pairs from FAQ")
    print(f"{'='*50}")

    faq_doc = next((d for d in documents if d["name"] == "faq"), None)
    if not faq_doc:
        print("  No FAQ page found, skipping")
        return []

    text = faq_doc["text"]
    lines = text.split("\n")
    pairs = []
    current_q = None

    for line in lines:
        line = line.strip()
        if not line:
            continue

        if line.endswith("?"):
            if current_q and pairs and pairs[-1]["answer"] == "":
                pairs.pop()
            current_q = line
            pairs.append({"question": current_q, "answer": ""})
        elif current_q and pairs:
            if pairs[-1]["answer"]:
                pairs[-1]["answer"] += " " + line
            else:
                pairs[-1]["answer"] = line

    pairs = [p for p in pairs if len(p["answer"]) > 20]

    print(f"  Extracted {len(pairs)} Q&A pairs")
    for p in pairs[:3]:
        q_preview = p["question"][:80]
        print(f"  - Q: {q_preview}")

    return pairs


def run_benchmark(index, chunks, device="cpu"):
    from sentence_transformers import SentenceTransformer

    print(f"\n{'='*50}")
    print(f"Running search benchmark ({len(BENCHMARK_QUERIES)} queries)")
    print(f"{'='*50}")

    model = SentenceTransformer(EMBEDDING_MODEL, device=device)
    k = 3
    results = []

    for query in BENCHMARK_QUERIES:
        q_emb = model.encode([query], normalize_embeddings=True, convert_to_numpy=True)
        scores, indices = index.search(q_emb, k)

        top_chunks = []
        for j in range(k):
            idx = indices[0][j]
            score = scores[0][j]
            if idx < len(chunks):
                top_chunks.append({
                    "rank": j + 1,
                    "score": float(score),
                    "source": chunks[idx]["source"],
                    "preview": chunks[idx]["text"][:120],
                })

        results.append({
            "query": query,
            "top_score": float(scores[0][0]),
            "results": top_chunks,
        })

        score_str = f"{scores[0][0]:.3f}"
        source = top_chunks[0]["source"] if top_chunks else "none"
        print(f"  [{score_str}] \"{query[:50]}\" -> {source}")

    avg_score = np.mean([r["top_score"] for r in results])
    print(f"\nAvg top-1 score: {avg_score:.3f}")

    return results, avg_score


def generate_markdown_files(documents):
    """Export scraped content as clean markdown files for Vector Store upload."""
    print(f"\n{'='*50}")
    print("Generating markdown knowledge base files")
    print(f"{'='*50}")

    kb_dir = os.path.join(OUTPUT_DIR, "knowledge")
    os.makedirs(kb_dir, exist_ok=True)

    for doc in documents:
        header = (
            f"# {doc['title']}\n"
            f"Source: {doc['url']}\n"
            f"Last updated: {doc['scraped_at']}\n\n"
            f"---\n\n"
        )
        content = header + doc["text"]
        path = os.path.join(kb_dir, f"{doc['name']}.md")
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)
        print(f"  {doc['name']}.md — {len(content)} chars")

    print(f"\n{len(documents)} markdown files written to {kb_dir}")
    print("Upload these to OpenAI Vector Store via /knowledge refresh or manually")
    return len(documents)


def save_output(filename, data, binary=False):
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    path = os.path.join(OUTPUT_DIR, filename)

    if binary:
        if isinstance(data, np.ndarray):
            np.save(path, data)
        else:
            import faiss
            faiss.write_index(data, path)
    else:
        with open(path, "w") as f:
            json.dump(data, f, indent=2, default=str)

    size_kb = os.path.getsize(path) / 1024
    print(f"Saved: {path} ({size_kb:.1f} KB)")


def main():
    start_time = time.time()
    print(f"Ocean Compute Job started at {datetime.utcnow().isoformat()}")
    print(f"Model: {EMBEDDING_MODEL} | Chunk: {CHUNK_SIZE}/{CHUNK_OVERLAP} | Batch: {BATCH_SIZE}")

    device = setup_device()

    # 1. Scrape
    documents = scrape_pages()
    if not documents:
        print("ERROR: No documents scraped, aborting")
        save_output("result.json", {"status": "failed", "error": "no documents scraped"})
        return

    # 2. Chunk
    chunks = chunk_documents(documents)

    # 3. Embeddings
    embeddings, dim = generate_embeddings(chunks, device)

    # 4. FAISS index
    index = build_faiss_index(embeddings, dim)

    # 5. Q&A extraction
    qa_pairs = extract_qa_pairs(documents)

    # 6. Markdown export for Vector Store
    md_count = generate_markdown_files(documents)

    # 7. Benchmark
    benchmark_results, avg_score = run_benchmark(index, chunks, device)

    # Save outputs
    elapsed = time.time() - start_time

    save_output("chunks.json", [
        {"id": c["id"], "source": c["source"], "url": c["url"],
         "chunk_index": c["chunk_index"], "text": c["text"]}
        for c in chunks
    ])
    save_output("qa_pairs.json", qa_pairs)
    save_output("benchmark.json", benchmark_results)
    save_output("embeddings.npy", embeddings, binary=True)
    save_output("index.faiss", index, binary=True)

    result = {
        "status": "completed",
        "timestamp": datetime.utcnow().isoformat(),
        "device": device,
        "model": EMBEDDING_MODEL,
        "config": {
            "chunk_size": CHUNK_SIZE,
            "chunk_overlap": CHUNK_OVERLAP,
            "batch_size": BATCH_SIZE,
        },
        "stats": {
            "pages_scraped": len(documents),
            "pages_failed": len(PAGES) - len(documents),
            "total_chunks": len(chunks),
            "embedding_dim": dim,
            "embeddings_size_mb": round(embeddings.nbytes / (1024 * 1024), 2),
            "qa_pairs": len(qa_pairs),
            "markdown_files": md_count,
            "avg_search_score": round(avg_score, 4),
        },
        "duration_seconds": round(elapsed, 1),
    }

    save_output("result.json", result)

    print(f"\n{'='*50}")
    print(f"Pipeline completed in {elapsed:.1f}s")
    print(f"Chunks: {len(chunks)} | QA pairs: {len(qa_pairs)} | Avg recall: {avg_score:.3f}")
    print(f"Output: {OUTPUT_DIR}")
    print(f"{'='*50}")


if __name__ == "__main__":
    main()
