import { createError } from 'h3'

export class AppError extends Error {
  public statusCode: number
  public isOperational: boolean

  constructor(message: string, statusCode: number) {
    super(message)
    this.statusCode = statusCode
    this.isOperational = true

    Error.captureStackTrace(this, this.constructor)
  }
}

export const handleError = (error: any) => {
  console.error('Error:', error)

  if (error instanceof AppError) {
    return createError({
      statusCode: error.statusCode,
      message: error.message
    })
  }

  // Errores de Prisma
  if (error.code === 'P2002') {
    return createError({
      statusCode: 409,
      message: 'El registro ya existe'
    })
  }

  if (error.code === 'P2025') {
    return createError({
      statusCode: 404,
      message: 'Registro no encontrado'
    })
  }

  // Errores de JWT
  if (error.name === 'JsonWebTokenError') {
    return createError({
      statusCode: 401,
      message: 'Token inválido'
    })
  }

  if (error.name === 'TokenExpiredError') {
    return createError({
      statusCode: 401,
      message: 'Token expirado'
    })
  }

  // Error genérico
  return createError({
    statusCode: 500,
    message: process.env.NODE_ENV === 'production' 
      ? 'Error interno del servidor' 
      : error.message
  })
}
