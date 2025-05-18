import { defineEventHandler, readBody } from "h3";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai";
import axios from "axios";
import NodeCache from "node-cache";

// Inicializar Prisma y Google AI
const prisma = new PrismaClient();

// Crear una instancia de caché con tiempo de expiración de 1 hora
const cache = new NodeCache({ stdTTL: 3600, checkperiod: 120 });

// Configuración de modelos - Nombres CORRECTOS de los modelos de Gemini
const PRIMARY_MODEL = "gemini-1.5-flash"; // Modelo más rápido y con menos restricciones
const FALLBACK_MODELS = ["gemini-pro", "gemini-pro-latest"]; // Modelos alternativos en orden de preferencia
const maxOutputTokens = 2048; // Reducido para evitar exceder límites

// Inicializar Google AI con manejo de múltiples claves API
let apiKeys = (process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || "").split(',').filter(Boolean);
let currentKeyIndex = 0;

// Función para obtener una instancia de Google AI con rotación de claves
function getGeminiClient() {
  if (!apiKeys.length) {
    throw new Error("No se han configurado claves API para Gemini");
  }
  
  // Rotación de claves para distribuir la carga
  const key = apiKeys[currentKeyIndex];
  currentKeyIndex = (currentKeyIndex + 1) % apiKeys.length;
  
  return new GoogleGenerativeAI(key);
}

// Función para obtener un modelo disponible
async function getAvailableModel(preferredModel = PRIMARY_MODEL) {
  const genAI = getGeminiClient();
  
  try {
    // Intentar con el modelo preferido primero
    const model = genAI.getGenerativeModel({ model: preferredModel });
    // Hacer una pequeña prueba para verificar que el modelo funciona
    await model.generateContent({
      contents: [{ role: "user", parts: [{ text: "Hola" }] }],
      generationConfig: { maxOutputTokens: 10 }
    });
    console.log(`Modelo ${preferredModel} disponible y funcionando`);
    return { model, modelName: preferredModel };
  } catch (error) {
    console.error(`Error con modelo ${preferredModel}:`, error);
    
    // Si el modelo preferido falla, intentar con los modelos de respaldo
    for (const fallbackModel of FALLBACK_MODELS) {
      try {
        console.log(`Intentando con modelo de respaldo: ${fallbackModel}`);
        const model = genAI.getGenerativeModel({ model: fallbackModel });
        // Hacer una pequeña prueba
        await model.generateContent({
          contents: [{ role: "user", parts: [{ text: "Hola" }] }],
          generationConfig: { maxOutputTokens: 10 }
        });
        console.log(`Modelo ${fallbackModel} disponible y funcionando`);
        return { model, modelName: fallbackModel };
      } catch (fallbackError) {
        console.error(`Error con modelo de respaldo ${fallbackModel}:`, fallbackError);
      }
    }
    
    // Si todos los modelos fallan, lanzar error
    throw new Error("No hay modelos de IA disponibles en este momento");
  }
}

// Configuración de YouTube API
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
const YOUTUBE_API_URL = "https://www.googleapis.com/youtube/v3/search";

// Definir interfaces para los tipos de datos
interface QuizData {
  question: string;
  options: string[];
  correctAnswer: string;
  explanation: string;
  timestamp: Date;
}

interface Ejemplo {
  id: number;
  titulo: string;
  problema: string;
  solucion: string;
  conclusion: string;
}

// Definir la interfaz para los temas
interface Topic {
  name: string;
  progress: number;
  completed: boolean;
  inProgress: boolean;
}

// Definir interfaz para videos de YouTube
interface VideoData {
  provider: string;
  videoId: string;
  title: string;
  description: string;
  thumbnailUrl: string;
}

// Sistema mejorado de limitación de tasa (rate limiting)
class RateLimiter {
  private requests = new Map<string, number[]>();
  private readonly limit: number;
  private readonly interval: number;
  private readonly keyLimits = new Map<string, { count: number, resetTime: number }>();

  constructor(limit = 10, interval = 60000) { // Aumentado a 10 por minuto
    this.limit = limit;
    this.interval = interval;
  }

  canMakeRequest(userId: number, apiKey?: string): boolean {
    const now = Date.now();
    const userKey = userId.toString();

    // Verificar límite por usuario
    if (!this.requests.has(userKey)) {
      this.requests.set(userKey, [now]);
      return true;
    }

    const userRequests = this.requests.get(userKey)!;
    const recentRequests = userRequests.filter(time => time > now - this.interval);

    // Si el usuario ha alcanzado su límite
    if (recentRequests.length >= this.limit) {
      return false;
    }

    // Verificar límite por clave API si se proporciona
    if (apiKey) {
      if (!this.keyLimits.has(apiKey)) {
        this.keyLimits.set(apiKey, { count: 1, resetTime: now + this.interval });
        return true;
      }

      const keyLimit = this.keyLimits.get(apiKey)!;
      
      // Reiniciar contador si ha pasado el tiempo
      if (now > keyLimit.resetTime) {
        keyLimit.count = 1;
        keyLimit.resetTime = now + this.interval;
        return true;
      }

      // Verificar si la clave ha alcanzado su límite (50 por minuto para Gemini)
      if (keyLimit.count >= 50) {
        return false;
      }

      keyLimit.count++;
    }

    this.requests.set(userKey, [...recentRequests, now]);
    return true;
  }

  getTimeUntilNextRequest(userId: number): number {
    const now = Date.now();
    const userKey = userId.toString();
    const userRequests = this.requests.get(userKey);

    if (!userRequests || userRequests.length === 0) return 0;

    const oldestRequest = Math.min(...userRequests);
    const timeUntilReset = this.interval - (now - oldestRequest);

    return Math.max(0, timeUntilReset);
  }
}

const rateLimiter = new RateLimiter();

// Almacenamiento persistente para mensajes de chat y datos de estudio
// Usamos caché para mejorar el rendimiento
const chatStorage = {
  messages: new Map<number, Array<{ role: string; content: string; timestamp: Date }>>(),
  currentTopics: new Map<number, string>(),
  topicsProgress: new Map<number, Map<string, { progress: number; completed: boolean }>>(),
  studyDocuments: new Map<number, Array<{ id: number; title: string; topics: string[]; type: string; url: string; }>>(),
  quizzes: new Map<string, QuizData>(),
};

// Función para verificar token
async function verifyToken(token: string) {
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "secret");
    return decoded;
  } catch (error) {
    return null;
  }
}

// Función optimizada para extraer temas de un documento usando la IA
async function extractTopicsFromDocument(documentUrl: string, documentName: string, documentType: string): Promise<string[]> {
  // Crear clave de caché para este documento
  const cacheKey = `topics_${documentName}_${documentType}`;
  
  // Verificar si ya tenemos los temas en caché
  const cachedTopics = cache.get<string[]>(cacheKey);
  if (cachedTopics) {
    return cachedTopics;
  }
  
  try {
    // Determinar el tipo de documento para personalizar el prompt
    let documentTypeDesc = "documento";
    if (documentType.includes("pdf")) {
      documentTypeDesc = "PDF";
    } else if (documentType.includes("word")) {
      documentTypeDesc = "documento Word";
    } else if (documentType.includes("spreadsheet")) {
      documentTypeDesc = "hoja de cálculo Excel";
    } else if (documentType.includes("presentation")) {
      documentTypeDesc = "presentación PowerPoint";
    }

    // Construir un prompt más corto y eficiente
    const prompt = `
      Analiza este material educativo: "${documentName}" (${documentTypeDesc})
      URL: ${documentUrl}
      
      Extrae 3-5 temas principales que probablemente cubre.
      Responde SOLO con los nombres de los temas separados por comas.
      Ejemplo: "Cinemática, Leyes de Newton, Conservación de Energía"
    `;

    // Obtener un modelo disponible
    const { model } = await getAvailableModel();

    // Crear una conversación con la IA
    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        maxOutputTokens: 256,
        temperature: 0.1,
      }
    });
    
    const response = await result.response;
    const topicsText = response.text();

    // Dividir la respuesta en temas individuales
    const topics = topicsText
      .split(",")
      .map((topic: string) => topic.trim())
      .filter((topic: string) => topic.length > 0);

    // Si no se encontraron temas, usar el nombre del documento como tema
    if (topics.length === 0) {
      const docName = documentName.split(".")[0];
      cache.set(cacheKey, [docName]);
      return [docName];
    }

    // Guardar en caché para futuras solicitudes
    cache.set(cacheKey, topics);
    return topics;
  } catch (error) {
    console.error("Error al extraer temas del documento:", error);
    // En caso de error, usar el nombre del documento como tema
    const docName = documentName.split(".")[0];
    return [docName];
  }
}

// Función optimizada para generar contenido del tema
const generateTopicContent = async (topic: string, retryCount = 0): Promise<string> => {
  // Verificar caché primero
  const cacheKey = `topic_content_${topic}`;
  const cachedContent = cache.get<string>(cacheKey);
  if (cachedContent) {
    return cachedContent;
  }
  
  try {
    const prompt = `
      Actúa como un tutor experto en ${topic}. 
      Proporciona una explicación estructurada con este formato:

      # ${topic}

      ## Definición
      [Definición concisa]

      ## Conceptos Clave
      - **[Concepto 1]**: [Explicación breve]
      - **[Concepto 2]**: [Explicación breve]
      - **[Concepto 3]**: [Explicación breve]

      ## Explicación Detallada
      [Explicación en párrafos]

      ## Ejemplo Resuelto
      Problema: [Problema práctico]
      
      Solución:
      1. [Primer paso]
      2. [Segundo paso]
      3. [Tercer paso]
      
      Conclusión: [Resultado]

      ## Aplicaciones Prácticas
      1. [Primera aplicación]
      2. [Segunda aplicación]
      3. [Tercera aplicación]
    `;

    // Obtener un modelo disponible
    const { model } = await getAvailableModel();

    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        maxOutputTokens: maxOutputTokens,
        temperature: 0.3,
      }
    });
    
    const response = await result.response;
    const content = response.text();
    
    // Guardar en caché para futuras solicitudes
    cache.set(cacheKey, content, 86400); // Caché por 24 horas
    
    return content;
  } catch (error: any) {
    console.error(`Error al generar contenido (intento ${retryCount + 1}):`, error);
    
    // Si es un error de cuota y tenemos más intentos, probar de nuevo
    if (error.status === 429 && retryCount < 2) {
      // Esperar un poco antes de reintentar
      await new Promise(resolve => setTimeout(resolve, 2000));
      return generateTopicContent(topic, retryCount + 1);
    }
    
    throw error;
  }
};

// Función optimizada para generar ejemplos adicionales
const generateAdditionalExamples = async (topic: string, retryCount = 0): Promise<string> => {
  // Verificar caché primero
  const cacheKey = `examples_${topic}`;
  const cachedExamples = cache.get<string>(cacheKey);
  if (cachedExamples) {
    return cachedExamples;
  }
  
  try {
    const prompt = `
      Genera dos ejemplos sobre ${topic} con este formato:

      # Ejemplo 1: [Título]
      
      ## Problema
      [Descripción del problema]

      ## Solución Paso a Paso
      1. [Primer paso]
         * **Explicación**: [Explicación]
      
      2. [Segundo paso]
         * **Explicación**: [Explicación]
      
      3. [Tercer paso]
         * **Explicación**: [Explicación]

      ## Conclusión
      [Resumen del resultado]

      # Ejemplo 2: [Título]
      [Mismo formato]
    `;

    // Obtener un modelo disponible
    const { model } = await getAvailableModel();

    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        maxOutputTokens: maxOutputTokens,
        temperature: 0.4,
      }
    });
    
    const response = await result.response;
    const examples = response.text();
    
    // Guardar en caché para futuras solicitudes
    cache.set(cacheKey, examples, 86400); // Caché por 24 horas
    
    return examples;
  } catch (error: any) {
    console.error(`Error al generar ejemplos (intento ${retryCount + 1}):`, error);
    
    // Si es un error de cuota y tenemos más intentos, probar de nuevo
    if (error.status === 429 && retryCount < 2) {
      // Esperar un poco antes de reintentar
      await new Promise(resolve => setTimeout(resolve, 2000));
      return generateAdditionalExamples(topic, retryCount + 1);
    }
    
    throw error;
  }
};

// Función optimizada para generar preguntas de quiz
const generateQuiz = async (topic: string, retryCount = 0): Promise<QuizData> => {
  // Verificar caché primero
  const cacheKey = `quiz_${topic}`;
  const cachedQuiz = cache.get<QuizData>(cacheKey);
  if (cachedQuiz) {
    return cachedQuiz;
  }
  
  try {
    const prompt = `
      Genera una pregunta de evaluación sobre ${topic} con este formato:

      PREGUNTA
      [Texto de la pregunta]

      OPCIONES
      A) [Opción A]
      B) [Opción B]
      C) [Opción C]
      D) [Opción D]

      RESPUESTA_CORRECTA
      [Letra de la respuesta correcta]

      EXPLICACION
      [Explicación detallada]
    `;

    // Obtener un modelo disponible
    const { model } = await getAvailableModel();

    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        maxOutputTokens: 2048, // Reducido para quiz
        temperature: 0.3,
      }
    });
    
    const response = await result.response;
    const responseText = response.text();

    // Extraer las partes del quiz
    const questionMatch = responseText.match(/PREGUNTA\n([\s\S]*?)\n\nOPCIONES/);
    const optionsMatch = responseText.match(/OPCIONES\n([\s\S]*?)\n\nRESPUESTA_CORRECTA/);
    const answerMatch = responseText.match(/RESPUESTA_CORRECTA\n([A-D])/);
    const explanationMatch = responseText.match(/EXPLICACION\n([\s\S]*?)$/);

    // Extraer las opciones individuales
    let options: string[] = [];
    if (optionsMatch && optionsMatch[1]) {
      const optionsText = optionsMatch[1].trim();
      options = [
        optionsText.match(/A\)(.*?)(?=\nB\)|$)/s)?.[1]?.trim() || "",
        optionsText.match(/B\)(.*?)(?=\nC\)|$)/s)?.[1]?.trim() || "",
        optionsText.match(/C\)(.*?)(?=\nD\)|$)/s)?.[1]?.trim() || "",
        optionsText.match(/D\)(.*?)(?=\n|$)/s)?.[1]?.trim() || "",
      ];
    }

    const quizData = {
      question: questionMatch ? questionMatch[1].trim() : "",
      options: options,
      correctAnswer: answerMatch ? answerMatch[1] : "",
      explanation: explanationMatch ? explanationMatch[1].trim() : "",
      timestamp: new Date()
    };
    
    // Guardar en caché para futuras solicitudes
    cache.set(cacheKey, quizData, 86400); // Caché por 24 horas
    
    return quizData;
  } catch (error: any) {
    console.error(`Error al generar quiz (intento ${retryCount + 1}):`, error);
    
    // Si es un error de cuota y tenemos más intentos, probar de nuevo
    if (error.status === 429 && retryCount < 2) {
      // Esperar un poco antes de reintentar
      await new Promise(resolve => setTimeout(resolve, 2000));
      return generateQuiz(topic, retryCount + 1);
    }
    
    throw error;
  }
};

// Función optimizada para buscar videos en YouTube con caché
async function buscarVideoYouTube(tema: string): Promise<VideoData> {
  // Verificar caché primero
  const cacheKey = `video_${tema}`;
  const cachedVideo = cache.get<VideoData>(cacheKey);
  if (cachedVideo) {
    return cachedVideo;
  }
  
  if (!YOUTUBE_API_KEY) {
    throw new Error("YouTube API Key no configurada");
  }

  try {
    // Buscar videos educativos sobre el tema
    const response = await axios.get(YOUTUBE_API_URL, {
      params: {
        part: "snippet",
        maxResults: 1,
        q: `${tema} educativo explicación tutorial`,
        type: "video",
        relevanceLanguage: "es",
        key: YOUTUBE_API_KEY,
      },
    });

    if (!response.data.items || response.data.items.length === 0) {
      throw new Error("No se encontraron videos");
    }

    const video = response.data.items[0];
    const videoData: VideoData = {
      provider: "youtube",
      videoId: video.id.videoId,
      title: video.snippet.title,
      description: video.snippet.description,
      thumbnailUrl: video.snippet.thumbnails.high.url,
    };
    
    // Guardar en caché para futuras solicitudes
    cache.set(cacheKey, videoData, 86400); // Caché por 24 horas
    
    return videoData;
  } catch (error) {
    console.error("Error al buscar videos en YouTube:", error);
    throw error;
  }
}

// Función optimizada para procesar el texto de respuesta
function procesarContenidoTema(responseText: string) {
  // Extraer título
  const titleMatch = responseText.match(/^#\s*(.*?)$/m) || responseText.match(/^(.*?)$/m);
  const title = titleMatch ? titleMatch[1].trim() : "";

  // Extraer definición
  const definitionRegex = /## Definición\n([\s\S]*?)(?=\n##)/i;
  const definitionMatch = responseText.match(definitionRegex);
  const definition = definitionMatch ? definitionMatch[1].trim() : "";

  // Extraer conceptos clave
  const conceptsRegex = /## Conceptos Clave\n([\s\S]*?)(?=\n##)/i;
  const conceptsMatch = responseText.match(conceptsRegex);
  const conceptsText = conceptsMatch ? conceptsMatch[1] : "";

  // Procesar cada concepto
  const conceptLines = conceptsText.split("\n").filter(line => line.trim().startsWith("-"));
  const concepts = conceptLines.map(line => {
    const cleanLine = line.replace(/^-\s*/, "").trim();
    const titleMatch = cleanLine.match(/\*\*(.*?)\*\*:(.*)/) || cleanLine.match(/(.*?):(.*)/);

    if (titleMatch) {
      return {
        title: titleMatch[1].replace(/\*\*/g, "").trim(),
        description: titleMatch[2].trim(),
      };
    }

    return {
      title: "Concepto",
      description: cleanLine,
    };
  });

  // Extraer explicación detallada
  const explanationRegex = /## Explicación Detallada\n([\s\S]*?)(?=\n##)/i;
  const explanationMatch = responseText.match(explanationRegex);
  const explanation = explanationMatch ? explanationMatch[1].trim() : "";

  // Extraer ejemplo resuelto
  const exampleRegex = /## Ejemplo Resuelto\n([\s\S]*?)(?=\n##|$)/i;
  const exampleMatch = responseText.match(exampleRegex);
  const exampleText = exampleMatch ? exampleMatch[1] : "";

  // Extraer problema y solución
  const problemRegex = /Problema:\s*([\s\S]*?)(?=\n\nSolución:)/i;
  const problemMatch = exampleText.match(problemRegex);
  const problem = problemMatch ? problemMatch[1].trim() : "";

  const solutionRegex = /Solución:\s*([\s\S]*?)(?=\n\nConclusión:|$)/i;
  const solutionMatch = exampleText.match(solutionRegex);
  const solution = solutionMatch ? solutionMatch[1].trim() : "";

  const conclusionRegex = /Conclusión:\s*([\s\S]*?)$/i;
  const conclusionMatch = exampleText.match(conclusionRegex);
  const conclusion = conclusionMatch ? conclusionMatch[1].trim() : "";

  // Extraer aplicaciones prácticas
  const applicationsRegex = /## Aplicaciones Prácticas\n([\s\S]*?)(?=\n##|$)/i;
  const applicationsMatch = responseText.match(applicationsRegex);
  const applicationsText = applicationsMatch ? applicationsMatch[1] : "";

  // Procesar aplicaciones
  const applicationLines = applicationsText.split("\n").filter(line => /^\d+\./.test(line.trim()));
  const applications = applicationLines.map(line => line.replace(/^\d+\.\s*/, "").trim());

  return {
    title,
    definition,
    concepts,
    explanation,
    example: {
      problem,
      solution,
      conclusion,
    },
    applications,
  };
}

// Función para generar respuesta de texto simple cuando la IA no está disponible
function generateFallbackResponse(topic: string | null = null): string {
  if (topic) {
    return `Lo siento, en este momento no puedo generar contenido detallado sobre ${topic} debido a limitaciones técnicas. Por favor, intenta de nuevo más tarde o consulta otras fuentes de información sobre este tema.`;
  }
  
  return "Lo siento, en este momento no puedo procesar tu solicitud debido a limitaciones técnicas. Por favor, intenta de nuevo más tarde.";
}

// Función para manejar errores de forma consistente
function handleApiError(error: any, userId: number) {
  console.error("Error en la API:", error);
  
  // Si es un error de límite de tasa
  if (error.status === 429) {
    return {
      status: 429,
      message: "Has alcanzado el límite de solicitudes. Por favor, intenta de nuevo en unos minutos.",
      waitTime: rateLimiter.getTimeUntilNextRequest(userId),
      messageType: "error",
    };
  }
  
  // Si es un error de modelo no encontrado
  if (error.status === 404) {
    return {
      status: 503,
      message: "El servicio de IA no está disponible en este momento. Por favor, intenta de nuevo más tarde.",
      messageType: "error",
    };
  }
  
  // Para otros errores
  return {
    status: 500,
    message: "Ocurrió un error al procesar tu solicitud. Por favor, intenta de nuevo más tarde.",
    error: error.message,
    messageType: "error",
  };
}

// Manejador principal de eventos
export default defineEventHandler(async (event) => {
  try {
    // Verificar autenticación
    const token = event.req.headers.authorization?.split(" ")[1];
    if (!token) {
      return {
        status: 401,
        message: "No autorizado",
      };
    }

    const decoded = (await verifyToken(token)) as any;
    if (!decoded) {
      return {
        status: 401,
        message: "Token inválido",
      };
    }

    const userId = decoded.userId;

    // Obtener datos del estudiante
    const estudiante = await prisma.estudiante.findUnique({
      where: { id: userId },
    });

    if (!estudiante) {
      return {
        status: 404,
        message: "Estudiante no encontrado",
      };
    }

    // Obtener mensaje del usuario
    const body = await readBody(event);
    const userMessage = body.message;

    // Inicializar almacenamiento para este usuario si no existe
    if (!chatStorage.messages.has(userId)) {
      chatStorage.messages.set(userId, []);
    }
    if (!chatStorage.topicsProgress.has(userId)) {
      chatStorage.topicsProgress.set(userId, new Map());
    }

    // Obtener historial de chat
    const chatHistory = chatStorage.messages.get(userId) || [];

    // Si es un mensaje de inicio, devolver información inicial
    if (userMessage === "inicio") {
      try {
        // Obtener materiales de la base de datos
        const materials = await prisma.material.findMany({
          where: {
            idAsignatura: decoded.asignaturaId,
            tipo: {
              in: [
                "application/pdf",
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "application/vnd.openxmlformats-officedocument.presentationml.presentation",
              ],
            },
          },
          select: {
            id: true,
            nombre: true,
            tipo: true,
            creadoEn: true,
            url: true,
          },
        });

        // Convertir los materiales al formato esperado y extraer temas
        const studyDocsPromises = materials.map(async (material) => {
          try {
            // Extraer temas del documento usando la IA
            const topics = await extractTopicsFromDocument(
              material.url,
              material.nombre,
              material.tipo
            );
            
            return {
              id: material.id,
              title: material.nombre,
              topics: topics,
              type: material.tipo.split("/").pop() || "document",
              url: material.url,
            };
          } catch (error) {
            console.error(`Error al procesar material ${material.nombre}:`, error);
            // En caso de error, usar el nombre del documento como tema
            return {
              id: material.id,
              title: material.nombre,
              topics: [material.nombre.split(".")[0]],
              type: material.tipo.split("/").pop() || "document",
              url: material.url,
            };
          }
        });

        // Procesar en paralelo para mejorar rendimiento
        const studyDocs = await Promise.all(studyDocsPromises);
        chatStorage.studyDocuments.set(userId, studyDocs);
      } catch (error) {
        console.error("Error al obtener materiales:", error);
        chatStorage.studyDocuments.set(userId, []);
      }

      // Obtener documentos y temas
      const documents = chatStorage.studyDocuments.get(userId) || [];
      const topicsProgressMap = chatStorage.topicsProgress.get(userId) || new Map();

      // Convertir el mapa de progreso a un array
      const formattedTopics = Array.from(topicsProgressMap.entries()).map(
        ([name, data]) => ({
          name,
          progress: data.progress,
          completed: data.completed,
          inProgress: data.progress > 0 && !data.completed,
        })
      );

      // Extraer temas de los documentos
      const defaultTopics: Topic[] = [];
      if (documents.length > 0) {
        documents.forEach((doc) => {
          if (doc.topics && doc.topics.length > 0) {
            doc.topics.forEach((topic) => {
              // Evitar duplicados
              if (!defaultTopics.some(t => t.name === topic)) {
                defaultTopics.push({
                  name: topic,
                  progress: 0,
                  completed: false,
                  inProgress: false,
                });
              }
            });
          }
        });
      }

      // Si hay temas extraídos y no hay temas formateados, usar los temas extraídos
      if (formattedTopics.length === 0 && defaultTopics.length > 0) {
        defaultTopics.forEach((topic) => {
          topicsProgressMap.set(topic.name, {
            progress: topic.progress,
            completed: topic.completed,
          });
        });

        chatStorage.topicsProgress.set(userId, topicsProgressMap);
      }

      return {
        text: null,
        messageType: "welcome",
        welcomeData: {
          title: "Bienvenido a tu Tutor Personal",
          description:
            "Estoy aquí para ayudarte a dominar los conceptos de física y potenciar tu aprendizaje académico.",
          features: [
            {
              icon: "book",
              title: "Explorar Temas",
              description:
                "Selecciona los materiales subidos por tu docente para estudiarlos en profundidad.",
            },
            {
              icon: "example",
              title: "Ejemplos Prácticos",
              description:
                "Solicita ejemplos detallados con soluciones paso a paso para comprender mejor los conceptos.",
            },
            {
              icon: "quiz",
              title: "Evaluación",
              description:
                "Pon a prueba tu conocimiento con preguntas tipo test y recibe feedback inmediato.",
            },
            {
              icon: "video",
              title: "Recursos Multimedia",
              description:
                "Accede a videos y recursos complementarios para enriquecer tu aprendizaje.",
            },
          ],
          cta: "¿Por dónde te gustaría comenzar hoy?",
        },
        estudiante: {
          nombre: estudiante.nombre,
          nivel: Math.floor(estudiante.xp / 100) + 1,
        },
        xp: estudiante.xp || 0,
        topics: formattedTopics.length > 0 ? formattedTopics : defaultTopics,
        documents: documents,
      };
    }

    // Si es una solicitud de estudio de tema
    if (userMessage.startsWith("STUDY_TOPIC:")) {
      const topic = userMessage.replace("STUDY_TOPIC:", "");

      // Registrar el tema actual que está estudiando el usuario
      chatStorage.currentTopics.set(userId, topic);

      // Verificar si el tema existe en el almacenamiento
      const topicsProgressMap = chatStorage.topicsProgress.get(userId) || new Map();

      if (!topicsProgressMap.has(topic)) {
        topicsProgressMap.set(topic, { progress: 0, completed: false });
        chatStorage.topicsProgress.set(userId, topicsProgressMap);
      }

      // Verificar límite de tasa
      if (!rateLimiter.canMakeRequest(userId)) {
        const waitTime = rateLimiter.getTimeUntilNextRequest(userId);
        return {
          status: 429,
          message: `Has alcanzado el límite de solicitudes. Por favor espera ${Math.ceil(
            waitTime / 1000
          )} segundos.`,
          waitTime,
          messageType: "error",
        };
      }

      try {
        // Generar contenido del tema
        const responseText = await generateTopicContent(topic);

        // Procesar el contenido para obtener secciones estructuradas
        const contenidoProcesado = procesarContenidoTema(responseText);

        // Guardar mensaje en el almacenamiento
        const chatMessages = chatStorage.messages.get(userId) || [];

        // Guardar el mensaje del usuario primero
        chatMessages.push({
          role: "user",
          content: `Quiero aprender sobre ${topic}`,
          timestamp: new Date(),
        });

        // Luego guardar la respuesta del asistente
        chatMessages.push({
          role: "model",
          content: responseText,
          timestamp: new Date(),
        });

        chatStorage.messages.set(userId, chatMessages);

        // Actualizar progreso del tema
        const topicData = topicsProgressMap.get(topic) || {
          progress: 0,
          completed: false,
        };
        topicData.progress = Math.min(100, topicData.progress + 10);
        topicData.completed = topicData.progress >= 100;
        topicsProgressMap.set(topic, topicData);

        // Generar un quiz para tener listo (en segundo plano)
        try {
          // Usamos setTimeout para no bloquear la respuesta principal
          setTimeout(async () => {
            try {
              const quizData = await generateQuiz(topic);
              const quizKey = `${userId}_lastQuiz`;
              chatStorage.quizzes.set(quizKey, {
                ...quizData,
                timestamp: new Date(),
              });
            } catch (error) {
              console.error("Error al generar quiz en segundo plano:", error);
            }
          }, 100);
        } catch (error) {
          // No interrumpimos el flujo principal si falla la generación del quiz
        }

        return {
          text: responseText,
          messageType: "topic",
          topicData: {
            title: contenidoProcesado.title || topic,
            definition: contenidoProcesado.definition,
            concepts: contenidoProcesado.concepts,
            explanation: contenidoProcesado.explanation,
            example: contenidoProcesado.example,
            applications: contenidoProcesado.applications,
          },
          currentTopic: topic,
          rawContent: responseText,
        };
      } catch (error: any) {
        // Si hay un error con la IA, proporcionar una respuesta de respaldo
        const fallbackResponse = generateFallbackResponse(topic);
        
        // Guardar mensaje en el almacenamiento
        const chatMessages = chatStorage.messages.get(userId) || [];
        chatMessages.push({
          role: "user",
          content: `Quiero aprender sobre ${topic}`,
          timestamp: new Date(),
        });
        chatMessages.push({
          role: "model",
          content: fallbackResponse,
          timestamp: new Date(),
        });
        chatStorage.messages.set(userId, chatMessages);
        
        return {
          text: fallbackResponse,
          messageType: "response",
          error: error.message,
        };
      }
    }

    // Para solicitudes de más ejemplos
    if (
      userMessage.toLowerCase().includes("más ejemplos") ||
      userMessage.toLowerCase().includes("otro ejemplo") ||
      body.requestType === "examples"
    ) {
      const temaActual = chatStorage.currentTopics.get(userId);

      if (!temaActual) {
        return {
          text: "Por favor, selecciona primero un tema de estudio para ver ejemplos.",
          messageType: "response",
        };
      }

      // Verificar límite de tasa
      if (!rateLimiter.canMakeRequest(userId)) {
        const waitTime = rateLimiter.getTimeUntilNextRequest(userId);
        return {
          status: 429,
          message: `Has alcanzado el límite de solicitudes. Por favor espera ${Math.ceil(
            waitTime / 1000
          )} segundos.`,
          waitTime,
          messageType: "error",
        };
      }

      try {
        const examples = await generateAdditionalExamples(temaActual);

        // Guardar mensaje en el almacenamiento
        const chatMessages = chatStorage.messages.get(userId) || [];
        chatMessages.push({
          role: "user",
          content: userMessage,
          timestamp: new Date(),
        });

        chatMessages.push({
          role: "model",
          content: examples,
          timestamp: new Date(),
        });

        chatStorage.messages.set(userId, chatMessages);

        // Actualizar progreso
        const topicsProgressMap = chatStorage.topicsProgress.get(userId) || new Map();
        const topicData = topicsProgressMap.get(temaActual) || {
          progress: 0,
          completed: false,
        };
        topicData.progress = Math.min(100, topicData.progress + 5);
        topicsProgressMap.set(temaActual, topicData);

        // Procesar ejemplos para mejor visualización
        const ejemplos: Ejemplo[] = [];
        const ejemploRegex = /# Ejemplo \d+: (.*?)(?=\n## Problema|\n$)/g;
        let match;
        let index = 0;

        while ((match = ejemploRegex.exec(examples)) !== null) {
          const titulo = match[1];
          const inicio = match.index + match[0].length;

          // Buscar el siguiente ejemplo o el final del texto
          const siguienteMatch = examples.indexOf("# Ejemplo", inicio);
          const fin = siguienteMatch > -1 ? siguienteMatch : examples.length;

          const contenidoEjemplo = examples.substring(inicio, fin);

          // Extraer problema
          const problemaMatch = contenidoEjemplo.match(
            /## Problema\n([\s\S]*?)(?=\n## Solución|\n$)/
          );
          const problema = problemaMatch ? problemaMatch[1].trim() : "";

          // Extraer solución
          const solucionMatch = contenidoEjemplo.match(
            /## Solución Paso a Paso\n([\s\S]*?)(?=\n## Conclusión|\n$)/
          );
          const solucion = solucionMatch ? solucionMatch[1].trim() : "";

          // Extraer conclusión
          const conclusionMatch = contenidoEjemplo.match(
            /## Conclusión\n([\s\S]*?)$/
          );
          const conclusion = conclusionMatch ? conclusionMatch[1].trim() : "";

          ejemplos.push({
            id: index++,
            titulo,
            problema,
            solucion,
            conclusion,
          });
        }

        return {
          text: examples,
          messageType: "examples",
          currentTopic: temaActual,
          ejemplosProcesados: ejemplos,
          rawContent: examples,
        };
      } catch (error: any) {
        // Si hay un error con la IA, proporcionar una respuesta de respaldo
        const fallbackResponse = `Lo siento, en este momento no puedo generar ejemplos adicionales sobre ${temaActual}. Por favor, intenta de nuevo más tarde.`;
        
        // Guardar mensaje en el almacenamiento
        const chatMessages = chatStorage.messages.get(userId) || [];
        chatMessages.push({
          role: "user",
          content: userMessage,
          timestamp: new Date(),
        });
        chatMessages.push({
          role: "model",
          content: fallbackResponse,
          timestamp: new Date(),
        });
        chatStorage.messages.set(userId, chatMessages);
        
        return {
          text: fallbackResponse,
          messageType: "response",
          error: error.message,
        };
      }
    }

    // Para respuestas a un quiz (A, B, C, D)
    if (/^[A-D]$/.test(userMessage)) {
      // Obtener el último quiz guardado
      const quizKey = `${userId}_lastQuiz`;
      const lastQuiz = chatStorage.quizzes.get(quizKey);

      if (!lastQuiz) {
        return {
          text: "No hay ninguna pregunta activa para responder. ¿Quieres intentar un nuevo quiz?",
          messageType: "response",
        };
      }

      const isCorrect = userMessage === lastQuiz.correctAnswer;
      const xpGanado = isCorrect ? 20 : 5;

      // Actualizar XP del estudiante
      await prisma.estudiante.update({
        where: { id: userId },
        data: { xp: { increment: xpGanado } },
      });

      // Actualizar progreso del tema si la respuesta es correcta
      if (isCorrect) {
        const temaActual = chatStorage.currentTopics.get(userId);
        if (temaActual) {
          const topicsProgressMap = chatStorage.topicsProgress.get(userId) || new Map();
          const topicData = topicsProgressMap.get(temaActual) || {
            progress: 0,
            completed: false,
          };
          topicData.progress = Math.min(100, topicData.progress + 20);
          topicData.completed = topicData.progress >= 100;
          topicsProgressMap.set(temaActual, topicData);
        }
      }

      // Guardar la respuesta del usuario
      const chatMessages = chatStorage.messages.get(userId) || [];
      chatMessages.push({
        role: "user",
        content: userMessage,
        timestamp: new Date(),
      });

      // Guardar la respuesta del asistente
      chatMessages.push({
        role: "model",
        content: isCorrect
          ? `Respuesta correcta: ${lastQuiz.correctAnswer}. ${lastQuiz.explanation}`
          : `Respuesta incorrecta. La respuesta correcta es ${lastQuiz.correctAnswer}. ${lastQuiz.explanation}`,
        timestamp: new Date(),
      });

      chatStorage.messages.set(userId, chatMessages);

      // Obtener XP actualizado
      const estudianteActualizado = await prisma.estudiante.findUnique({
        where: { id: userId },
      });

      return {
        text: isCorrect
          ? "¡Excelente trabajo! Tu respuesta es correcta."
          : `Esa no es la respuesta correcta. La respuesta correcta es ${lastQuiz.correctAnswer}.`,
        messageType: "quiz_response",
        answerFeedback: {
          isCorrect: isCorrect,
          selectedAnswer: userMessage,
          correctAnswer: lastQuiz.correctAnswer,
          feedback: lastQuiz.explanation,
        },
        xp: estudianteActualizado?.xp || estudiante.xp,
      };
    }

    // Para solicitudes de video
    if (
      userMessage.toLowerCase().includes("video") ||
      userMessage.toLowerCase().includes("multimedia") ||
      userMessage.toLowerCase().includes("ver") ||
      body.requestType === "video"
    ) {
      const temaActual = chatStorage.currentTopics.get(userId);

      if (!temaActual) {
        return {
          text: "¿Sobre qué tema te gustaría ver un video? Por favor, selecciona primero un tema de estudio.",
          messageType: "response",
        };
      }

      // Verificar límite de tasa
      if (!rateLimiter.canMakeRequest(userId)) {
        const waitTime = rateLimiter.getTimeUntilNextRequest(userId);
        return {
          status: 429,
          message: `Has alcanzado el límite de solicitudes. Por favor espera ${Math.ceil(
            waitTime / 1000
          )} segundos.`,
          waitTime,
          messageType: "error",
        };
      }

      // Buscar videos relacionados con el tema usando la API de YouTube
      try {
        const videoData = await buscarVideoYouTube(temaActual);

        // Guardar mensaje en el almacenamiento
        const chatMessages = chatStorage.messages.get(userId) || [];
        chatMessages.push({
          role: "user",
          content: userMessage,
          timestamp: new Date(),
        });

        chatMessages.push({
          role: "model",
          content: `Aquí tienes un video sobre ${temaActual}: ${videoData.title} (https://www.youtube.com/watch?v=${videoData.videoId})`,
          timestamp: new Date(),
        });

        chatStorage.messages.set(userId, chatMessages);

        // Actualizar progreso
        const topicsProgressMap = chatStorage.topicsProgress.get(userId) || new Map();
        const topicData = topicsProgressMap.get(temaActual) || {
          progress: 0,
          completed: false,
        };
        topicData.progress = Math.min(100, topicData.progress + 5);
        topicsProgressMap.set(temaActual, topicData);

        return {
          text: `Aquí tienes un video educativo sobre ${temaActual}:`,
          messageType: "video",
          videoData: videoData,
        };
      } catch (error: any) {
        // Si hay un error con la API de YouTube, proporcionar una respuesta de respaldo
        const fallbackResponse = `Lo siento, no pude encontrar videos sobre ${temaActual} en este momento. Por favor, intenta de nuevo más tarde o busca directamente en YouTube.`;
        
        // Guardar mensaje en el almacenamiento
        const chatMessages = chatStorage.messages.get(userId) || [];
        chatMessages.push({
          role: "user",
          content: userMessage,
          timestamp: new Date(),
        });
        chatMessages.push({
          role: "model",
          content: fallbackResponse,
          timestamp: new Date(),
        });
        chatStorage.messages.set(userId, chatMessages);
        
        return {
          text: fallbackResponse,
          messageType: "response",
          error: error.message,
        };
      }
    }

    // Para solicitudes de evaluación o quiz
    if (
      userMessage.toLowerCase().includes("quiz") ||
      userMessage.toLowerCase().includes("pregunta") ||
      userMessage.toLowerCase().includes("evalua") ||
      userMessage.toLowerCase().includes("test") ||
      body.requestType === "quiz"
    ) {
      const temaActual = chatStorage.currentTopics.get(userId);

      if (!temaActual) {
        return {
          text: "Para generar preguntas de evaluación, primero necesito saber sobre qué tema quieres practicar. Por favor, selecciona un tema de estudio.",
          messageType: "response",
        };
      }

      // Verificar límite de tasa
      if (!rateLimiter.canMakeRequest(userId)) {
        const waitTime = rateLimiter.getTimeUntilNextRequest(userId);
        return {
          status: 429,
          message: `Has alcanzado el límite de solicitudes. Por favor espera ${Math.ceil(
            waitTime / 1000
          )} segundos.`,
          waitTime,
          messageType: "error",
        };
      }

      // Generar quiz
      try {
        const quizData = await generateQuiz(temaActual);

        // Guardar el quiz actual en el almacenamiento para verificar la respuesta después
        const quizKey = `${userId}_lastQuiz`;
        chatStorage.quizzes.set(quizKey, {
          ...quizData,
          timestamp: new Date(),
        });

        // Guardar mensajes en el almacenamiento
        const chatMessages = chatStorage.messages.get(userId) || [];
        chatMessages.push({
          role: "user",
          content: userMessage,
          timestamp: new Date(),
        });

        // No guardamos la respuesta correcta ni la explicación en el mensaje visible
        chatMessages.push({
          role: "model",
          content: `Pregunta: ${quizData.question}\n\nOpciones:\nA) ${quizData.options[0]}\nB) ${quizData.options[1]}\nC) ${quizData.options[2]}\nD) ${quizData.options[3]}`,
          timestamp: new Date(),
        });

        chatStorage.messages.set(userId, chatMessages);

        return {
          text: "Aquí tienes una pregunta para evaluar tu conocimiento:",
          messageType: "quiz",
          quiz: {
            question: quizData.question,
            options: quizData.options,
            // No enviamos la respuesta correcta ni la explicación aquí
          },
        };
      } catch (error: any) {
        // Si hay un error con la IA, proporcionar una respuesta de respaldo
        const fallbackResponse = `Lo siento, en este momento no puedo generar preguntas de evaluación sobre ${temaActual}. Por favor, intenta de nuevo más tarde.`;
        
        // Guardar mensaje en el almacenamiento
        const chatMessages = chatStorage.messages.get(userId) || [];
        chatMessages.push({
          role: "user",
          content: userMessage,
          timestamp: new Date(),
        });
        chatMessages.push({
          role: "model",
          content: fallbackResponse,
          timestamp: new Date(),
        });
        chatStorage.messages.set(userId, chatMessages);
        
        return {
          text: fallbackResponse,
          messageType: "response",
          error: error.message,
        };
      }
    }

    // Para cualquier otro mensaje, usar Gemini para generar respuesta
    try {
      // Verificar límite de tasa
      if (!rateLimiter.canMakeRequest(userId)) {
        const waitTime = rateLimiter.getTimeUntilNextRequest(userId);
        return {
          status: 429,
          message: `Has alcanzado el límite de solicitudes. Por favor espera ${Math.ceil(
            waitTime / 1000
          )} segundos.`,
          waitTime,
          messageType: "error",
        };
      }

      // Construir contexto para el modelo
      const temaActual = chatStorage.currentTopics.get(userId);
      const nivelEstudiante = Math.floor(estudiante.xp / 100) + 1;

      // Verificar si tenemos una respuesta en caché para este mensaje
      const cacheKey = `chat_${userId}_${userMessage.substring(0, 50)}`;
      const cachedResponse = cache.get<string>(cacheKey);
      
      let responseText;
      
      if (cachedResponse) {
        responseText = cachedResponse;
      } else {
        try {
          // Obtener un modelo disponible
          const { model } = await getAvailableModel();
          
          const systemPrompt = `
            Eres un tutor educativo especializado en ayudar a estudiantes.
            
            Información del estudiante:
            - Nombre: ${estudiante.nombre}
            - Nivel: ${nivelEstudiante}
            ${temaActual ? `- Tema actual de estudio: ${temaActual}` : ""}
            
            Tu objetivo es:
            1. Proporcionar explicaciones claras y concisas
            2. Adaptar tus respuestas al nivel del estudiante
            3. Fomentar el pensamiento crítico
            4. Ser amigable y motivador
            
            Responde de manera conversacional y natural.
            Estructura tus respuestas con secciones claras y ejemplos paso a paso.
          `;
          
          // Formatear historial para el modelo - máximo 5 mensajes recientes para evitar exceder tokens
          const recentHistory = chatHistory.slice(-5).map((msg) => ({
            role: msg.role === "user" ? "user" : "model",
            parts: [{ text: msg.content }],
          }));
          
          // Crear contenido para la generación
          const contents = [
            { role: "user", parts: [{ text: systemPrompt }] }
          ];
          
          // Añadir historial reciente si existe
          if (recentHistory.length > 0) {
            recentHistory.forEach(msg => {
              contents.push({
                role: msg.role as "user" | "model",
                parts: msg.parts
              });
            });
          }
          
          // Añadir mensaje actual
          contents.push({ 
            role: "user", 
            parts: [{ text: userMessage }] 
          });
          
          // Generar respuesta
          const result = await model.generateContent({
            contents,
            generationConfig: {
              maxOutputTokens: maxOutputTokens,
              temperature: 0.7,
            },
            safetySettings: [
              {
                category: HarmCategory.HARM_CATEGORY_HARASSMENT,
                threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
              },
              {
                category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
                threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
              },
            ],
          });
          
          responseText = result.response.text();
          
          // Guardar en caché para futuras solicitudes similares
          cache.set(cacheKey, responseText, 3600); // Caché por 1 hora
        } catch (error: any) {
          console.error("Error al generar respuesta:", error);
          
          // Si todos los modelos fallan, usar una respuesta de respaldo
          responseText = generateFallbackResponse();
        }
      }

      // Guardar mensajes en el almacenamiento
      const chatMessages = chatStorage.messages.get(userId) || [];
      chatMessages.push({
        role: "user",
        content: userMessage,
        timestamp: new Date(),
      });

      chatMessages.push({
        role: "model",
        content: responseText,
        timestamp: new Date(),
      });

      // Limitar el historial a los últimos 20 mensajes para evitar problemas de memoria
      if (chatMessages.length > 20) {
        chatMessages.splice(0, chatMessages.length - 20);
      }

      chatStorage.messages.set(userId, chatMessages);

      // Actualizar XP del estudiante por interacción
      await prisma.estudiante.update({
        where: { id: userId },
        data: { xp: { increment: 2 } },
      });

      // Obtener datos actualizados
      const estudianteActualizado = await prisma.estudiante.findUnique({
        where: { id: userId },
      });

      return {
        text: responseText,
        messageType: "response",
        xp: estudianteActualizado?.xp || estudiante.xp,
      };
    } catch (error: any) {
      return handleApiError(error, userId);
    }
  } catch (error: any) {
    console.error("Error en chat.post.ts:", error);
    return {
      status: 500,
      message: "Error interno del servidor",
      error: error.message,
    };
  }
});