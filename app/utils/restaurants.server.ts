import { type User } from '@prisma/client'
import { cachified } from '@epic-web/cachified'
import { invariant } from '@epic-web/invariant'
import { prisma } from './db.server'
import { getNearbyRestaurants } from './providers/google-places.server'
import { cache, lruCache } from './cache.server'

// Types
export type RestaurantWithDetails = {
  id: string
  name: string
  priceLevel: number | null
  rating: number | null
  lat: number
  lng: number
  photoRef: string | null
  mapsUrl: string | null
  distance: number // in miles
  attendeeCount: number
  isUserAttending: boolean
}

type GetAllRestaurantDetailsParams = {
  lat: number
  lng: number
  radius: number // in meters
  userId: string
}

/**
 * Calculate distance between two coordinates in miles
 */
function calculateDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180
  
  const earthRadiusMiles = 3958.8 // Earth's radius in miles
  
  const dLat = toRadians(lat2 - lat1)
  const dLng = toRadians(lng2 - lng1)
  
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2)
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  const distance = earthRadiusMiles * c
  
  // Round to 1 decimal place
  return Math.round(distance * 10) / 10
}

/**
 * Fetch restaurants from Google Places API and cache them
 */
async function fetchAndCacheRestaurants(lat: number, lng: number, radius: number) {
  const restaurants = await getNearbyRestaurants({ lat, lng, radius })
  
  // Upsert restaurants to database
  await Promise.all(
    restaurants.map(async (restaurant) => {
      await prisma.restaurant.upsert({
        where: { id: restaurant.id },
        update: {
          name: restaurant.name,
          priceLevel: restaurant.priceLevel,
          rating: restaurant.rating,
          lat: restaurant.lat,
          lng: restaurant.lng,
          photoRef: restaurant.photoRef,
          mapsUrl: restaurant.mapsUrl,
          updatedAt: new Date(),
        },
        create: {
          id: restaurant.id,
          name: restaurant.name,
          priceLevel: restaurant.priceLevel,
          rating: restaurant.rating,
          lat: restaurant.lat,
          lng: restaurant.lng,
          photoRef: restaurant.photoRef,
          mapsUrl: restaurant.mapsUrl,
        },
      })
    }),
  )
  
  return restaurants
}

/**
 * Get all restaurants from database
 */
async function getAllRestaurants() {
  return prisma.restaurant.findMany()
}

/**
 * Get attendee count for each restaurant
 */
async function getAttendeeCountByRestaurant() {
  const dinnerGroups = await prisma.dinnerGroup.findMany({
    include: {
      _count: {
        select: {
          attendees: true,
        },
      },
    },
  })
  
  return dinnerGroups.reduce<Record<string, number>>((acc, group) => {
    acc[group.restaurantId] = group._count.attendees
    return acc
  }, {})
}

/**
 * Get the restaurant the user is attending
 */
async function getUserAttendingRestaurant(userId: string) {
  const attendee = await prisma.attendee.findUnique({
    where: { userId },
    include: {
      dinnerGroup: true,
    },
  })
  
  return attendee?.dinnerGroup.restaurantId || null
}

/**
 * Get all restaurant details including attendance and distance
 */
export async function getAllRestaurantDetails({
  lat,
  lng,
  radius,
  userId,
}: GetAllRestaurantDetailsParams): Promise<RestaurantWithDetails[]> {
  // Cache API calls to Google Places
  const restaurants = await cachified({
    key: `restaurants:${lat}:${lng}:${radius}`,
    cache: lruCache,
    ttl: 1000 * 60 * 30, // 30 minutes
    staleWhileRevalidate: 1000 * 60 * 60 * 24, // 24 hours
    getFreshValue: () => fetchAndCacheRestaurants(lat, lng, radius),
  })
  
  // Cache database queries for restaurant data
  const dbRestaurants = await cachified({
    key: 'restaurants:all',
    cache,
    ttl: 1000 * 60 * 5, // 5 minutes
    staleWhileRevalidate: 1000 * 60 * 30, // 30 minutes
    getFreshValue: getAllRestaurants,
  })
  
  // Do NOT cache attendance data (must be real-time)
  const attendeeCounts = await getAttendeeCountByRestaurant()
  const userAttendingRestaurantId = await getUserAttendingRestaurant(userId)
  
  // Combine all data
  const allRestaurants = [...restaurants, ...dbRestaurants]
  
  // Remove duplicates
  const uniqueRestaurants = Array.from(
    new Map(allRestaurants.map((r) => [r.id, r])).values(),
  )
  
  // Add attendance and distance data
  return uniqueRestaurants.map((restaurant) => ({
    ...restaurant,
    distance: calculateDistance(lat, lng, restaurant.lat, restaurant.lng),
    attendeeCount: attendeeCounts[restaurant.id] || 0,
    isUserAttending: restaurant.id === userAttendingRestaurantId,
  }))
}

/**
 * Join a dinner group for a restaurant
 */
export async function joinDinnerGroup({
  userId,
  restaurantId,
}: {
  userId: string
  restaurantId: string
}) {
  // First, check if the user is already in a dinner group
  const existingAttendee = await prisma.attendee.findUnique({
    where: { userId },
    include: { dinnerGroup: true },
  })
  
  // If they are, and it's the same restaurant, do nothing
  if (existingAttendee?.dinnerGroup.restaurantId === restaurantId) {
    return { success: true }
  }
  
  // If they are in a different group, leave that group first
  if (existingAttendee) {
    await prisma.attendee.delete({
      where: { id: existingAttendee.id },
    })
  }
  
  // Find or create a dinner group for the restaurant
  let dinnerGroup = await prisma.dinnerGroup.findUnique({
    where: { restaurantId },
  })
  
  if (!dinnerGroup) {
    dinnerGroup = await prisma.dinnerGroup.create({
      data: { restaurantId },
    })
  }
  
  // Add the user to the dinner group
  await prisma.attendee.create({
    data: {
      userId,
      dinnerGroupId: dinnerGroup.id,
    },
  })
  
  return { success: true }
}

/**
 * Leave a dinner group
 */
export async function leaveDinnerGroup({ userId }: { userId: string }) {
  const attendee = await prisma.attendee.findUnique({
    where: { userId },
  })
  
  if (!attendee) {
    return { success: true }
  }
  
  await prisma.attendee.delete({
    where: { id: attendee.id },
  })
  
  return { success: true }
} 