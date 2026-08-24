import { seedE2EUsers } from "./helpers";

export default async function globalSetup(): Promise<void> {
  await seedE2EUsers();
}
