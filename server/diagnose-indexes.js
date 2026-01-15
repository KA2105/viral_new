const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  const indexes = await prisma.$queryRawUnsafe(`PRAGMA index_list('User');`);
  console.log('User indexes:', indexes);

  // Her indexin kolonlarını da yaz
  for (const idx of indexes) {
    const info = await prisma.$queryRawUnsafe(`PRAGMA index_info('${idx.name}');`);
    console.log(`\nIndex: ${idx.name}`, info);
  }

  await prisma.$disconnect();
})();
