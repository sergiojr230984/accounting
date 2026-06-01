/**
 * Bootstrap de producción — se ejecuta en cada arranque del deploy (ver
 * railway.json), PERO solo siembra datos si la base está vacía. Así garantiza
 * que en el primer deploy exista un admin para iniciar sesión y las 3
 * vendedoras, sin volver a tocar nada en deploys posteriores.
 *
 * A diferencia de `prisma/seed.ts` (datos de demo para desarrollo), aquí NO se
 * crean facturas ni clientes de ejemplo: solo lo mínimo para operar el CRM.
 */
import { PrismaClient, Role, LeadStatus, LeadPriority, LeadSource, MessageDirection } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const userCount = await prisma.user.count();
  if (userCount > 0) {
    console.log(`Bootstrap: ya existen ${userCount} usuarios, omito la siembra inicial.`);
    return;
  }

  console.log("Bootstrap: base de datos vacía → creando admin y equipo de ventas…");

  // Administrador del CRM
  await prisma.user.create({
    data: {
      name: "Administrador",
      email: "admin@lacuevita.com",
      password: await bcrypt.hash("admin123", 12),
      role: Role.ADMIN,
    },
  });

  // Las 3 vendedoras (sin phone_number_id todavía; se agrega al conectar WhatsApp)
  const vendedoras = [
    { id: "sp-ana", name: "Ana Torres", email: "ana@lacuevita.com", wa: "+5215511110001" },
    { id: "sp-brenda", name: "Brenda Ruiz", email: "brenda@lacuevita.com", wa: "+5215511110002" },
    { id: "sp-carla", name: "Carla Méndez", email: "carla@lacuevita.com", wa: "+5215511110003" },
  ];
  const salesPassword = await bcrypt.hash("ventas123", 12);
  for (const v of vendedoras) {
    await prisma.user.create({
      data: {
        id: v.id,
        name: v.name,
        email: v.email,
        password: salesPassword,
        role: Role.SALES,
        whatsappNumber: v.wa,
      },
    });
  }

  // Configuración del CRM (rotación automática activada)
  await prisma.crmSetting.upsert({
    where: { id: "singleton" },
    update: {},
    create: { id: "singleton", assignmentMode: "ROUND_ROBIN" },
  });

  // Lead con el número real de prueba, listo para probar el envío de WhatsApp
  await prisma.lead.create({
    data: {
      name: "Número de prueba",
      phone: "+17863163774",
      status: LeadStatus.NEW,
      priority: LeadPriority.HIGH,
      source: LeadSource.WHATSAPP,
      assignedToId: "sp-ana",
      lastMessageText: "Hola, este es un mensaje de prueba 👋",
      lastMessageAt: new Date(),
      messages: {
        create: { direction: MessageDirection.INBOUND, body: "Hola, este es un mensaje de prueba 👋" },
      },
      assignments: { create: { toUserId: "sp-ana", reason: "bootstrap" } },
    },
  });

  console.log("Bootstrap: listo. Admin: admin@lacuevita.com / admin123 (cámbiala).");
}

main()
  .catch((e) => {
    // No bloqueamos el arranque de la app si la siembra falla: solo registramos.
    console.error("Bootstrap falló (la app arrancará igual):", e);
  })
  .finally(() => prisma.$disconnect());
