import { type LoaderFunctionArgs, type ActionFunctionArgs } from 'react-router'
import { useLoaderData, useSearchParams, useFetcher } from 'react-router'
import { z } from 'zod'
import { invariant } from '@epic-web/invariant'
import { requireUserId } from '#app/utils/auth.server'
import { prisma } from '#app/utils/db.server'
import { 
  getAllRestaurantDetails, 
  joinDinnerGroup, 
  leaveDinnerGroup,
  type RestaurantWithDetails 
} from '#app/utils/restaurants.server'
import { cn } from '#app/utils/misc'
import { StatusButton } from '#app/components/ui/status-button'

// Zod schema for validating action form data
const ActionSchema = z.discriminatedUnion('intent', [
  z.object({
    intent: z.literal('join'),
    restaurantId: z.string(),
  }),
  z.object({
    intent: z.literal('leave'),
  }),
])

// Zod schema for validating URL search params
const SearchParamsSchema = z.object({
  distance: z.coerce.number().optional(),
  rating: z.coerce.number().optional(),
  price: z.coerce.number().optional(),
})

export async function loader({ request, params }: LoaderFunctionArgs) {
  const userId = await requireUserId(request)
  
  // Hilton coordinates (40.7596, -111.8867)
  const hiltonLat = 40.7596
  const hiltonLng = -111.8867
  
  // Parse search params for filtering
  const url = new URL(request.url)
  const searchParams = SearchParamsSchema.safeParse({
    distance: url.searchParams.get('distance') ? Number(url.searchParams.get('distance')) : undefined,
    rating: url.searchParams.get('rating') ? Number(url.searchParams.get('rating')) : undefined,
    price: url.searchParams.get('price') ? Number(url.searchParams.get('price')) : undefined,
  })
  
  // Default radius is 1 mile (1609.34 meters)
  let radius = 1609.34
  
  // If distance filter is provided, convert miles to meters
  if (searchParams.success && searchParams.data.distance) {
    radius = searchParams.data.distance * 1609.34
  }
  
  // Get all restaurant details
  const allRestaurants = await getAllRestaurantDetails({
    lat: hiltonLat,
    lng: hiltonLng,
    radius: radius * 5, // Fetch a larger radius than needed for filtering
    userId,
  })
  
  // Split into two lists
  const restaurantsWithAttendance = allRestaurants
    .filter(restaurant => restaurant.attendeeCount > 0)
    .sort((a, b) => b.attendeeCount - a.attendeeCount)
  
  // Apply filters to restaurants without attendees
  let restaurantsNearby = allRestaurants
    .filter(restaurant => restaurant.attendeeCount === 0)
  
  // Apply distance filter
  if (searchParams.success && searchParams.data.distance) {
    restaurantsNearby = restaurantsNearby.filter(
      restaurant => restaurant.distance <= searchParams.data.distance!
    )
  } else {
    // Default to 1 mile if no distance filter
    restaurantsNearby = restaurantsNearby.filter(
      restaurant => restaurant.distance <= 1
    )
  }
  
  // Apply rating filter
  if (searchParams.success && searchParams.data.rating) {
    restaurantsNearby = restaurantsNearby.filter(
      restaurant => (restaurant.rating || 0) >= searchParams.data.rating!
    )
  }
  
  // Apply price filter
  if (searchParams.success && searchParams.data.price) {
    restaurantsNearby = restaurantsNearby.filter(
      restaurant => restaurant.priceLevel === searchParams.data.price
    )
  }
  
  // Sort by rating (desc) and distance (asc) as tiebreaker
  restaurantsNearby = restaurantsNearby
    .sort((a, b) => {
      // First sort by rating (descending)
      const ratingDiff = (b.rating || 0) - (a.rating || 0)
      if (ratingDiff !== 0) return ratingDiff
      
      // Then by distance (ascending) as tiebreaker
      return a.distance - b.distance
    })
    .slice(0, 15) // Limit to top 15 results
  
  return {
    restaurantsWithAttendance,
    restaurantsNearby,
    filters: searchParams.success ? searchParams.data : {},
  }
}

export async function action({ request }: ActionFunctionArgs) {
  const userId = await requireUserId(request)
  const formData = await request.formData()
  
  const result = ActionSchema.safeParse(Object.fromEntries(formData))
  
  if (!result.success) {
    return { 
      status: 'error', 
      errors: result.error.flatten() 
    }
  }
  
  const { intent } = result.data
  
  if (intent === 'join') {
    const { restaurantId } = result.data
    return joinDinnerGroup({ userId, restaurantId })
  } else if (intent === 'leave') {
    return leaveDinnerGroup({ userId })
  }
  
  return { status: 'error', message: 'Invalid intent' }
}

export default function RestaurantsRoute() {
  // This is a placeholder for Phase 4 - UI Routes Frontend
  return (
    <div>
      <h1>Restaurants</h1>
      <p>This page will be implemented in Phase 4.</p>
    </div>
  )
} 