import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const all = await prisma.user.findMany({
    select: { id: true, deviceId: true, email: true, phone: true, handle: true },
    orderBy: { id: "asc" },
  });

  console.log("TOTAL USERS:", all.length);
  console.log(all);

  const emptyPhone = all.filter(u => u.phone === "");
  console.log("\nphone === '' count:", emptyPhone.length, emptyPhone);

  const emptyEmail = all.filter(u => u.email === "");
  console.log("\nemail === '' count:", emptyEmail.length, emptyEmail);

  const emptyHandle = all.filter(u => u.handle === "");
  console.log("\nhandle === '' count:", emptyHandle.length, emptyHandle);
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
