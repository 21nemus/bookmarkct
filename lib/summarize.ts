const SUMMARY_LENGTH = 200;

export async function summarizeText(text: string): Promise<string> {
  const trimmed = text.trim();

  if (trimmed.length <= SUMMARY_LENGTH) {
    return trimmed;
  }

  return `${trimmed.slice(0, SUMMARY_LENGTH)}...`;
}
