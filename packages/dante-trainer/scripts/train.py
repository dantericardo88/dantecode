#!/usr/bin/env python3
"""
packages/dante-trainer/scripts/train.py

Unsloth LoRA fine-tuning script for dante-next-edit model.
Fine-tunes Qwen2.5-Coder-7B-Instruct on edit-sequence prediction.

Hardware requirements:
  - A100 40GB: ~6 hours, ~$7 on Lambda Labs ($1.10/hr)
  - A10G 24GB: ~12 hours, ~$13 on RunPod ($1.09/hr)
  - RTX 4090 24GB: ~16 hours (local)

Usage:
  pip install unsloth datasets trl transformers accelerate bitsandbytes
  python scripts/train.py --data ./data/train.jsonl --output ./dante-next-edit-v1

Options:
  --data        Path to Alpaca-format JSONL training data
  --output      Output directory for model weights
  --model       Base model (default: unsloth/Qwen2.5-Coder-7B-Instruct-bnb-4bit)
  --epochs      Number of training epochs (default: 2)
  --rank        LoRA rank (default: 64)
  --lr          Learning rate (default: 2e-4)
  --batch-size  Per-device batch size (default: 4)
  --grad-accum  Gradient accumulation steps (default: 4)
  --max-seq     Max sequence length in tokens (default: 2048)
  --eval-split  Validation split fraction (default: 0.1)
"""

import argparse
import json
import sys
from pathlib import Path

def parse_args():
    p = argparse.ArgumentParser(description="Train dante-next-edit via Unsloth LoRA")
    p.add_argument("--data", default="./data/train.jsonl")
    p.add_argument("--output", default="./dante-next-edit-v1")
    p.add_argument("--model", default="unsloth/Qwen2.5-Coder-7B-Instruct-bnb-4bit")
    p.add_argument("--epochs", type=int, default=2)
    p.add_argument("--rank", type=int, default=64, choices=[8, 16, 32, 64, 128])
    p.add_argument("--lr", type=float, default=2e-4)
    p.add_argument("--batch-size", type=int, default=4)
    p.add_argument("--grad-accum", type=int, default=4)
    p.add_argument("--max-seq", type=int, default=2048)
    p.add_argument("--eval-split", type=float, default=0.1)
    return p.parse_args()


def format_alpaca_prompt(instruction: str, input_text: str, output: str = "") -> str:
    """Convert Alpaca record to prompt string for SFTTrainer."""
    prompt = (
        f"### Instruction:\n{instruction}\n\n"
        f"### Input:\n{input_text}\n\n"
        f"### Response:\n{output}"
    )
    return prompt


def load_alpaca_dataset(data_path: str, eval_split: float):
    """Load JSONL in Alpaca format and split into train/eval."""
    try:
        from datasets import Dataset
    except ImportError:
        print("ERROR: Install datasets: pip install datasets")
        sys.exit(1)

    records = []
    with open(data_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                record = json.loads(line)
                records.append({
                    "text": format_alpaca_prompt(
                        record["instruction"],
                        record["input"],
                        record["output"],
                    )
                })
            except (json.JSONDecodeError, KeyError):
                continue

    print(f"Loaded {len(records)} training examples from {data_path}")
    dataset = Dataset.from_list(records)
    split = dataset.train_test_split(test_size=eval_split, seed=42)
    return split["train"], split["test"]


def main():
    args = parse_args()

    # Validate data path
    if not Path(args.data).exists():
        print(f"ERROR: Training data not found: {args.data}")
        print("Run: npx edit-dataset collect --repos microsoft/vscode --out data/train.jsonl")
        sys.exit(1)

    print(f"=== dante-next-edit Training ===")
    print(f"Base model:  {args.model}")
    print(f"Data:        {args.data}")
    print(f"Output:      {args.output}")
    print(f"LoRA rank:   {args.rank}")
    print(f"Epochs:      {args.epochs}")
    print(f"LR:          {args.lr}")
    print(f"Batch:       {args.batch_size} × {args.grad_accum} grad accum")
    print()

    try:
        from unsloth import FastLanguageModel
    except ImportError:
        print("ERROR: Install unsloth: pip install unsloth")
        print("Full install guide: https://github.com/unslothai/unsloth")
        sys.exit(1)

    try:
        from trl import SFTTrainer, SFTConfig
    except ImportError:
        print("ERROR: Install trl: pip install trl")
        sys.exit(1)

    # Load base model with 4-bit quantization (fits in 16GB VRAM)
    print("Loading base model...")
    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name=args.model,
        max_seq_length=args.max_seq,
        load_in_4bit=True,
        dtype=None,   # auto-detect
    )

    # Apply LoRA adapters
    print(f"Applying LoRA (rank={args.rank})...")
    model = FastLanguageModel.get_peft_model(
        model,
        r=args.rank,
        target_modules=[
            "q_proj", "k_proj", "v_proj", "o_proj",
            "gate_proj", "up_proj", "down_proj",
        ],
        lora_alpha=args.rank,          # alpha = rank for simplicity
        lora_dropout=0,                # 0 is best per Unsloth benchmarks
        bias="none",
        use_gradient_checkpointing="unsloth",
        random_state=42,
    )

    # Load dataset
    train_ds, eval_ds = load_alpaca_dataset(args.data, args.eval_split)
    print(f"Train: {len(train_ds)} | Eval: {len(eval_ds)}")

    # Training config
    training_args = SFTConfig(
        output_dir=args.output,
        num_train_epochs=args.epochs,
        per_device_train_batch_size=args.batch_size,
        per_device_eval_batch_size=args.batch_size,
        gradient_accumulation_steps=args.grad_accum,
        learning_rate=args.lr,
        warmup_ratio=0.1,
        lr_scheduler_type="cosine",
        fp16=not FastLanguageModel.is_bfloat16_supported(),
        bf16=FastLanguageModel.is_bfloat16_supported(),
        logging_steps=10,
        eval_strategy="epoch",
        save_strategy="epoch",
        load_best_model_at_end=True,
        metric_for_best_model="eval_loss",
        seed=42,
        dataset_text_field="text",
        max_seq_length=args.max_seq,
        packing=True,
    )

    trainer = SFTTrainer(
        model=model,
        tokenizer=tokenizer,
        train_dataset=train_ds,
        eval_dataset=eval_ds,
        args=training_args,
    )

    print("Starting training...")
    trainer.train()

    # Save final model
    print(f"Saving to {args.output}...")
    model.save_pretrained(args.output)
    tokenizer.save_pretrained(args.output)
    print("Done. Next: run scripts/quantize.sh to create GGUF for Ollama.")


if __name__ == "__main__":
    main()
