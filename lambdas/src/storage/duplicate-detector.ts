import { docClient, TableNames } from '../shared/db';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';

export interface DuplicateCheckResult {
  isDuplicate: boolean;
  duplicateOfId: string | null;
}

/**
 * Parse a waiver code into base code and optional update number.
 * Recognises suffixes: -U\d+, -REV\d+, -V\d+ (case-insensitive).
 * e.g. "WVR-1234-U2" → { baseCode: "WVR-1234", updateNumber: "U2" }
 *      "WVR-1234"    → { baseCode: "WVR-1234", updateNumber: null }
 */
export function parseWaiverCode(waiverCode: string): {
  baseCode: string;
  updateNumber: string | null;
} {
  const match = waiverCode.match(/^(.+)-(U\d+|REV\d+|V\d+)$/i);
  if (match) {
    return { baseCode: match[1], updateNumber: match[2] };
  }
  return { baseCode: waiverCode, updateNumber: null };
}

/**
 * Query the GSI for existing waivers with the same airline_code and waiver_code.
 * Returns the ID of the earliest matching record, or null if no match.
 */
export async function checkForDuplicate(
  airlineCode: string,
  waiverCode: string,
): Promise<DuplicateCheckResult> {
  if (!airlineCode || !waiverCode) {
    return { isDuplicate: false, duplicateOfId: null };
  }

  try {
    const result = await docClient.send(new QueryCommand({
      TableName: TableNames.waivers,
      IndexName: 'airline_code-waiver_code-index',
      KeyConditionExpression: 'airline_code = :ac AND waiver_code = :wc',
      ExpressionAttributeValues: {
        ':ac': airlineCode,
        ':wc': waiverCode,
      },
    }));

    const items = result.Items ?? [];
    if (items.length === 0) {
      return { isDuplicate: false, duplicateOfId: null };
    }

    // Pick the record with the earliest created_at
    items.sort((a, b) => {
      const aDate = (a.created_at as string) ?? '';
      const bDate = (b.created_at as string) ?? '';
      return aDate.localeCompare(bDate);
    });

    return {
      isDuplicate: true,
      duplicateOfId: items[0].id as string,
    };
  } catch (err) {
    console.error('Duplicate detection GSI query failed:', err);
    return { isDuplicate: false, duplicateOfId: null };
  }
}
