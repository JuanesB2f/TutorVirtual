import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  // Crear un usuario administrador por defecto si no existe
  const adminExists = await prisma.usuario.findFirst({
    where: {
      rol: 'ADMIN'
    }
  })

  if (!adminExists) {
    await prisma.usuario.create({
      data: {
        documentoIdentidad: 'ADMIN001',
        nombre: 'Administrador',
        rol: 'ADMIN',
        correo: 'admin@tutorvirtual.com',
        contrasena: '$2b$10$rQZ8K9mN2pL1vX3yW4uJ5eF6gH7iI8jK9lM0nO1pQ2rS3tU4vW5xY6zA7bC8dE9fG0hI1jJ2kL3mN4oO5pP6qQ7rR8sS9tT0uU1vV2wW3xX4yY5zZ', // admin123
        telefono: '3000000000'
      }
    })
    console.log('Usuario administrador creado')
  }

  console.log('Seed completado')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

