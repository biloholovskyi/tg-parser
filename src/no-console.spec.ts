import * as fs from 'fs';
import * as path from 'path';

const SOURCE_ROOT = __dirname;
const CONSOLE_USAGE_PATTERN = /\bconsole\s*\./;
const SPEC_FILE_PATTERN = /\.(spec|e2e-spec)\.ts$/;

/** Every production `.ts` file under `src/`, spec files excluded. Read-only walk. */
function listProductionSources(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return listProductionSources(entryPath);
    }
    const isProductionSource = entry.name.endsWith('.ts') && !SPEC_FILE_PATTERN.test(entry.name);
    return isProductionSource ? [entryPath] : [];
  });
}

describe('production sources', () => {
  it('scans a non-empty set of production files', () => {
    // Act
    const actualFiles = listProductionSources(SOURCE_ROOT);

    // Assert
    expect(actualFiles.length).toBeGreaterThan(0);
    expect(actualFiles.some((file) => file.endsWith('telegram.service.ts'))).toBe(true);
    expect(actualFiles.some((file) => SPEC_FILE_PATTERN.test(file))).toBe(false);
  });

  it('contain no console usage (output goes through the NestJS Logger)', () => {
    // Arrange
    const inputFiles = listProductionSources(SOURCE_ROOT);

    // Act
    const actualOffenders = inputFiles
      .filter((file) => CONSOLE_USAGE_PATTERN.test(fs.readFileSync(file, 'utf-8')))
      .map((file) => path.relative(SOURCE_ROOT, file));

    // Assert
    expect(actualOffenders).toEqual([]);
  });
});
