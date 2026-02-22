export type CommandToCopy = {
  buttonName: string;
  command: string;
};

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function parseCommandsToCopyFromAsset(payload: unknown): CommandToCopy[] {
  if (!Array.isArray(payload)) {
    return [];
  }

  const commands: CommandToCopy[] = [];
  for (const entry of payload) {
    if (!isObjectRecord(entry)) {
      continue;
    }

    const rawButtonName = entry.button_name;
    const rawCommand = entry.command;
    if (typeof rawButtonName !== "string" || typeof rawCommand !== "string") {
      continue;
    }

    const buttonName = rawButtonName.trim();
    if (!buttonName) {
      continue;
    }

    commands.push({
      buttonName,
      command: rawCommand,
    });
  }

  return commands;
}
