import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname } from "path";

export class JsonFileRepo<T> {
  constructor(
    private filePath: string,
    private fallback: () => T
  ) {}

  async get(): Promise<T> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      return JSON.parse(raw) as T;
    } catch {
      const seed = this.fallback();
      await this.set(seed);
      return seed;
    }
  }

  async set(value: T): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(value, null, 2), "utf8");
  }
}
