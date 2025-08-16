import { defineEventHandler } from 'h3'
import { handleError } from '../utils/errorHandler'

export default defineEventHandler(async (event) => {
  try {
    // Continuar con el manejo normal de la request
    return
  } catch (error) {
    // Manejar errores globalmente
    return handleError(error)
  }
})
