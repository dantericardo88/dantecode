// Benchmark test file for enterprise readiness validation
// This file is used to test DanteCode's performance on various task complexities

export function calculateTotal(items: number[]): number {
  // Calculate the sum of all items
  let total = 0;
  for (const item of items) {
    total += item;
  }
  return total;
}

export function processData(data: string): string {
  // Process data with basic transformations
  return data.trim().toUpperCase();
}

export class UserValidator {
  validateEmail(email: string): boolean {
    // Simple email validation
    return email.includes('@');
  }

  validateAge(age: number): boolean {
    // Age must be between 0 and 150
    return age >= 0 && age <= 150;
  }
}
