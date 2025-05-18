<template>
  <div 
    ref="containerRef" 
    class="virtualized-chat-list" 
    @scroll="handleScroll"
  >
    <div 
      class="virtualized-chat-content" 
      :style="{ height: `${totalHeight}px` }"
    >
      <div 
        v-for="(item, index) in visibleItems" 
        :key="index" 
        :style="{ 
          position: 'absolute', 
          top: `${item.offset}px`, 
          width: '100%' 
        }"
      >
        <slot name="item" :item="item.data" :index="item.index"></slot>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { useThrottleFn } from '@vueuse/core';

interface Props {
  items: any[];
  itemHeight: (item: any) => number;
  buffer?: number;
}

const props = withDefaults(defineProps<Props>(), {
  buffer: 5
});

const containerRef = ref<HTMLElement | null>(null);
const scrollTop = ref(0);
const containerHeight = ref(0);

// Calcular la altura total del contenido
const itemPositions = computed(() => {
  let offset = 0;
  return props.items.map((item, index) => {
    const height = props.itemHeight(item);
    const currentOffset = offset;
    offset += height;
    return {
      index,
      data: item,
      height,
      offset: currentOffset,
    };
  });
});

const totalHeight = computed(() => {
  if (itemPositions.value.length === 0) return 0;
  const lastItem = itemPositions.value[itemPositions.value.length - 1];
  return lastItem.offset + lastItem.height;
});

// Determinar qué elementos son visibles
const visibleItems = computed(() => {
  if (!containerRef.value) return [];
  
  const startOffset = Math.max(0, scrollTop.value - props.buffer * 100);
  const endOffset = scrollTop.value + containerHeight.value + props.buffer * 100;
  
  return itemPositions.value.filter(
    item => (item.offset + item.height > startOffset) && (item.offset < endOffset)
  );
});

// Manejar el evento de scroll
const handleScroll = useThrottleFn(() => {
  if (!containerRef.value) return;
  scrollTop.value = containerRef.value.scrollTop;
}, 16); // ~60fps

// Actualizar dimensiones del contenedor
const updateContainerHeight = () => {
  if (!containerRef.value) return;
  containerHeight.value = containerRef.value.clientHeight;
};

// Método para hacer scroll al final
const scrollToBottom = (behavior: ScrollBehavior = 'auto') => {
  if (!containerRef.value) return;
  
  // Usar setTimeout para asegurar que el DOM se ha actualizado
  setTimeout(() => {
    if (containerRef.value) {
      containerRef.value.scrollTo({
        top: totalHeight.value,
        behavior
      });
    }
  }, 0);
};

// Método para hacer scroll a un elemento específico
const scrollToItem = (index: number, behavior: ScrollBehavior = 'auto') => {
  if (!containerRef.value || index < 0 || index >= props.items.length) return;
  
  const targetItem = itemPositions.value[index];
  containerRef.value.scrollTo({
    top: targetItem.offset,
    behavior
  });
};

// Exponer métodos para uso externo
defineExpose({
  scrollToBottom,
  scrollToItem
});

// Observar cambios en los elementos para actualizar el scroll
watch(() => props.items.length, (newLength, oldLength) => {
  if (newLength > oldLength) {
    // Si se añadieron nuevos elementos y estamos cerca del final, scroll al final
    if (containerRef.value) {
      const isNearBottom = 
        containerRef.value.scrollHeight - containerRef.value.scrollTop - containerRef.value.clientHeight < 100;
      
      if (isNearBottom) {
        scrollToBottom();
      }
    }
  }
});

// Configurar observador de redimensionamiento
let resizeObserver: ResizeObserver | null = null;

onMounted(() => {
  if (containerRef.value) {
    updateContainerHeight();
    
    // Crear un observador de redimensionamiento
    resizeObserver = new ResizeObserver(updateContainerHeight);
    resizeObserver.observe(containerRef.value);
    
    // Scroll inicial al final
    scrollToBottom();
  }
  
  // Añadir listener para redimensionamiento de ventana
  window.addEventListener('resize', updateContainerHeight);
});

onUnmounted(() => {
  // Limpiar observador y listeners
  if (resizeObserver && containerRef.value) {
    resizeObserver.unobserve(containerRef.value);
    resizeObserver.disconnect();
  }
  
  window.removeEventListener('resize', updateContainerHeight);
});
</script>

<style scoped>
.virtualized-chat-list {
  position: relative;
  overflow-y: auto;
  height: 100%;
  width: 100%;
  will-change: transform; /* Optimización de rendimiento */
  overscroll-behavior: contain; /* Prevenir scroll chaining */
}

.virtualized-chat-content {
  position: relative;
  width: 100%;
}
</style>