// ============================================================================
// @dantecode/cli — Vault Command
// Subcommands for managing the encrypted credential vault.
// ============================================================================

import { CredentialVault } from '@dantecode/core';
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

// ----------------------------------------------------------------------------
// ANSI Colors
// ----------------------------------------------------------------------------

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

// ----------------------------------------------------------------------------
// Vault Command Handler
// ----------------------------------------------------------------------------

export async function runVaultCommand(subArgs: string[]): Promise<void> {
  const sub = subArgs[0];

  switch (sub) {
    case 'store': {
      const keyName = subArgs[1];
      if (!keyName) {
        process.stderr.write(`${RED}Usage: dantecode vault store <keyName>${RESET}\n`);
        process.exit(1);
      }
      const rl = readline.createInterface({ input, output });
      const value = await rl.question(`Enter value for ${keyName}: `);
      rl.close();
      const v = new CredentialVault();
      await v.store(keyName, value);
      process.stdout.write(`${GREEN}Stored:${RESET} ${keyName}\n`);
      break;
    }

    case 'list': {
      const v = new CredentialVault();
      const names = await v.list();
      if (names.length === 0) {
        process.stdout.write(`${DIM}No credentials stored.${RESET}\n`);
      } else {
        names.forEach((n: string) => process.stdout.write(`  ${n}\n`));
      }
      break;
    }

    case 'remove': {
      const keyName = subArgs[1];
      if (!keyName) {
        process.stderr.write(`${RED}Usage: dantecode vault remove <keyName>${RESET}\n`);
        process.exit(1);
      }
      const v = new CredentialVault();
      await v.remove(keyName);
      process.stdout.write(`${GREEN}Removed:${RESET} ${keyName}\n`);
      break;
    }

    default: {
      process.stdout.write(
        [
          'Usage: dantecode vault <subcommand>',
          '',
          'Subcommands:',
          '  store <keyName>   Store an API key in the encrypted vault',
          '  list              List stored credential names',
          '  remove <keyName>  Remove a stored credential',
          '',
        ].join('\n'),
      );
      break;
    }
  }
}
