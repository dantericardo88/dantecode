#!/usr/bin/env python3
"""
Cost Tracking for SWE-bench Runs

Calculates actual costs based on model pricing and token usage.
Supports Grok, Claude, and OpenAI models.
"""

from typing import Dict, Tuple

# Model pricing (per 1K tokens)
# Updated as of March 2026
MODEL_RATES = {
    # Grok models
    'grok/grok-3': {
        'input': 0.0001,   # $0.10 per 1M tokens
        'output': 0.0003,  # $0.30 per 1M tokens
        'speed': 'fast',
        'quality': 'high'
    },
    'grok/grok-beta': {
        'input': 0.00005,  # $0.05 per 1M tokens
        'output': 0.00015, # $0.15 per 1M tokens
        'speed': 'very_fast',
        'quality': 'medium'
    },

    # Claude models
    'anthropic/claude-opus-4-6': {
        'input': 0.015,    # $15 per 1M tokens
        'output': 0.075,   # $75 per 1M tokens
        'speed': 'medium',
        'quality': 'highest'
    },
    'anthropic/claude-sonnet-4-6': {
        'input': 0.003,    # $3 per 1M tokens
        'output': 0.015,   # $15 per 1M tokens
        'speed': 'fast',
        'quality': 'high'
    },
    'anthropic/claude-haiku-4-5': {
        'input': 0.00025,  # $0.25 per 1M tokens
        'output': 0.00125, # $1.25 per 1M tokens
        'speed': 'very_fast',
        'quality': 'good'
    },

    # OpenAI models
    'openai/gpt-4-turbo': {
        'input': 0.01,     # $10 per 1M tokens
        'output': 0.03,    # $30 per 1M tokens
        'speed': 'fast',
        'quality': 'very_high'
    },
    'openai/gpt-4o': {
        'input': 0.0025,   # $2.50 per 1M tokens
        'output': 0.01,    # $10 per 1M tokens
        'speed': 'very_fast',
        'quality': 'high'
    },
    'openai/gpt-3.5-turbo': {
        'input': 0.0005,   # $0.50 per 1M tokens
        'output': 0.0015,  # $1.50 per 1M tokens
        'speed': 'very_fast',
        'quality': 'good'
    }
}

class CostTracker:
    """Track and calculate costs for model API usage"""

    def __init__(self):
        self.total_cost = 0.0
        self.total_input_tokens = 0
        self.total_output_tokens = 0
        self.model_costs = {}  # Track per-model costs

    def calculate_cost(self, model: str, input_tokens: int, output_tokens: int) -> float:
        """
        Calculate cost for a single API call.

        Args:
            model: Model identifier (e.g., 'grok/grok-3')
            input_tokens: Number of input tokens
            output_tokens: Number of output tokens

        Returns:
            Cost in USD
        """
        if model not in MODEL_RATES:
            # Unknown model, use average rates
            print(f"Warning: Unknown model '{model}', using default rates")
            rates = {'input': 0.001, 'output': 0.003}
        else:
            rates = MODEL_RATES[model]

        input_cost = (input_tokens / 1000) * rates['input']
        output_cost = (output_tokens / 1000) * rates['output']
        total_cost = input_cost + output_cost

        # Track totals
        self.total_cost += total_cost
        self.total_input_tokens += input_tokens
        self.total_output_tokens += output_tokens

        # Track per-model
        if model not in self.model_costs:
            self.model_costs[model] = {
                'cost': 0.0,
                'input_tokens': 0,
                'output_tokens': 0,
                'calls': 0
            }

        self.model_costs[model]['cost'] += total_cost
        self.model_costs[model]['input_tokens'] += input_tokens
        self.model_costs[model]['output_tokens'] += output_tokens
        self.model_costs[model]['calls'] += 1

        return total_cost

    def estimate_cost(self, model: str, total_tokens: int,
                     input_output_ratio: float = 0.7) -> float:
        """
        Estimate cost when only total tokens are known.

        Args:
            model: Model identifier
            total_tokens: Total tokens (input + output)
            input_output_ratio: Assumed ratio of input to total (default 0.7 = 70% input, 30% output)

        Returns:
            Estimated cost in USD
        """
        input_tokens = int(total_tokens * input_output_ratio)
        output_tokens = total_tokens - input_tokens
        return self.calculate_cost(model, input_tokens, output_tokens)

    def get_model_info(self, model: str) -> Dict[str, any]:
        """Get pricing and metadata for a model"""
        if model not in MODEL_RATES:
            return None
        return MODEL_RATES[model].copy()

    def get_summary(self) -> Dict[str, any]:
        """Get summary of all tracked costs"""
        return {
            'total_cost_usd': self.total_cost,
            'total_input_tokens': self.total_input_tokens,
            'total_output_tokens': self.total_output_tokens,
            'total_tokens': self.total_input_tokens + self.total_output_tokens,
            'by_model': self.model_costs.copy()
        }

    def format_cost_report(self) -> str:
        """Generate a formatted cost report"""
        summary = self.get_summary()

        report = []
        report.append("=" * 60)
        report.append("COST SUMMARY")
        report.append("=" * 60)
        report.append(f"Total Cost: ${summary['total_cost_usd']:.4f}")
        report.append(f"Total Tokens: {summary['total_tokens']:,}")
        report.append(f"  Input: {summary['total_input_tokens']:,}")
        report.append(f"  Output: {summary['total_output_tokens']:,}")
        report.append("")

        if summary['by_model']:
            report.append("By Model:")
            for model, data in summary['by_model'].items():
                report.append(f"  {model}:")
                report.append(f"    Cost: ${data['cost']:.4f}")
                report.append(f"    Tokens: {data['input_tokens'] + data['output_tokens']:,}")
                report.append(f"    Calls: {data['calls']}")

        report.append("=" * 60)
        return "\n".join(report)

def compare_model_costs(instances: int, avg_tokens_per_instance: int = 10000) -> Dict[str, float]:
    """
    Compare costs across different models for a given workload.

    Args:
        instances: Number of SWE-bench instances
        avg_tokens_per_instance: Average tokens per instance

    Returns:
        Dict of model -> total cost
    """
    costs = {}
    tracker = CostTracker()

    for model in MODEL_RATES.keys():
        cost = tracker.estimate_cost(model, avg_tokens_per_instance)
        costs[model] = cost * instances

    return costs

if __name__ == "__main__":
    # Example usage
    tracker = CostTracker()

    # Simulate some API calls
    print("Example: Cost tracking for SWE-bench run")
    print()

    # Grok instance
    cost1 = tracker.calculate_cost('grok/grok-3', input_tokens=5000, output_tokens=2000)
    print(f"Grok instance: ${cost1:.4f}")

    # Claude instance
    cost2 = tracker.calculate_cost('anthropic/claude-sonnet-4-6', input_tokens=5000, output_tokens=2000)
    print(f"Claude instance: ${cost2:.4f}")

    print()
    print(tracker.format_cost_report())

    # Model comparison
    print()
    print("Cost Comparison for 50 SWE-bench instances:")
    print()
    comparison = compare_model_costs(instances=50, avg_tokens_per_instance=10000)
    for model, cost in sorted(comparison.items(), key=lambda x: x[1]):
        print(f"{model:40} ${cost:8.2f}")
