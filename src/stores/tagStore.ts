import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { v4 as uuidv4 } from 'uuid'
import type { Tag } from '@/types'
import { TAG_COLORS } from '@/types'

interface TagState {
  tags: Tag[]

  // Actions
  addTag: (name: string, color?: string) => Tag
  updateTag: (id: string, updates: Partial<Tag>) => void
  deleteTag: (id: string) => void

  // Getters
  getTagById: (id: string) => Tag | undefined
  getTagByName: (name: string) => Tag | undefined
  getOrCreateTag: (name: string) => Tag
}

export const useTagStore = create<TagState>()(
  persist(
    (set, get) => ({
      tags: [],

      addTag: (name, color) => {
        const existingTag = get().tags.find(
          t => t.name.toLowerCase() === name.toLowerCase()
        )
        if (existingTag) return existingTag

        const usedColors = get().tags.map(t => t.color)
        const availableColor = TAG_COLORS.find(c => !usedColors.includes(c)) || TAG_COLORS[0]

        const newTag: Tag = {
          id: uuidv4(),
          name: name.trim(),
          color: color || availableColor,
          createdAt: Date.now()
        }

        set(state => ({
          tags: [...state.tags, newTag]
        }))

        return newTag
      },

      updateTag: (id, updates) => {
        set(state => ({
          tags: state.tags.map(tag =>
            tag.id === id ? { ...tag, ...updates } : tag
          )
        }))
      },

      deleteTag: (id) => {
        set(state => ({
          tags: state.tags.filter(tag => tag.id !== id)
        }))
      },

      // Getters
      getTagById: (id) => get().tags.find(tag => tag.id === id),

      getTagByName: (name) =>
        get().tags.find(tag => tag.name.toLowerCase() === name.toLowerCase()),

      getOrCreateTag: (name) => {
        const existing = get().getTagByName(name)
        if (existing) return existing
        return get().addTag(name)
      }
    }),
    {
      name: 'noteser-tags'
    }
  )
)
