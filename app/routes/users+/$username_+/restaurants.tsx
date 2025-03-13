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
import { 
  Card, 
  CardContent, 
  CardFooter, 
  CardHeader 
} from '#app/components/ui/card'
import { Toggle } from '#app/components/ui/toggle'
import { 
  MapPin, 
  Map, 
  Star, 
  Users 
} from 'lucide-react'

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
  const { restaurantsWithAttendance, restaurantsNearby, filters } = useLoaderData<typeof loader>()
  
  return (
    <div className="container py-8">
      <h1 className="text-3xl font-bold mb-8">Find Restaurants</h1>
      
      <div className="space-y-8">
        <DinnerPlansSection restaurants={restaurantsWithAttendance} />
        <RestaurantListSection restaurants={restaurantsNearby} filters={filters} />
      </div>
    </div>
  )
}

function DinnerPlansSection({ restaurants }: { restaurants: RestaurantWithDetails[] }) {
  return (
    <section>
      <h2 className="text-2xl font-bold mb-4">Dinner Plans</h2>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {restaurants.length > 0 ? (
          restaurants.map(restaurant => (
            <RestaurantCard key={restaurant.id} restaurant={restaurant} />
          ))
        ) : (
          <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 flex items-center justify-center h-[250px]">
            <p className="text-gray-500 text-center">Everyone is having dinner on their own 🥲</p>
          </div>
        )}
      </div>
    </section>
  )
}

function RestaurantListSection({ 
  restaurants, 
  filters 
}: { 
  restaurants: RestaurantWithDetails[], 
  filters: Record<string, any> 
}) {
  return (
    <section>
      <h2 className="text-2xl font-bold mb-4">Restaurants Nearby</h2>
      
      <Filters currentFilters={filters} />
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-4">
        {restaurants.map(restaurant => (
          <RestaurantCard key={restaurant.id} restaurant={restaurant} />
        ))}
      </div>
    </section>
  )
}

function Filters({ currentFilters }: { currentFilters: Record<string, any> }) {
  const [searchParams, setSearchParams] = useSearchParams()
  
  const updateFilter = (key: string, value: string | null) => {
    const newParams = new URLSearchParams(searchParams)
    
    if (value === null) {
      newParams.delete(key)
    } else {
      newParams.set(key, value)
    }
    
    setSearchParams(newParams, { preventScrollReset: true, replace: true })
  }
  
  const isActive = (key: string, value: string) => {
    return searchParams.get(key) === value
  }
  
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <span className="text-sm font-medium py-2">Distance:</span>
        {[1, 2, 5, 10].map(distance => (
          <Toggle
            key={`distance-${distance}`}
            pressed={isActive('distance', distance.toString())}
            onPressedChange={(pressed) => {
              updateFilter('distance', pressed ? distance.toString() : null)
            }}
            className="flex-1"
          >
            {distance}mi
          </Toggle>
        ))}
      </div>
      
      <div className="flex flex-wrap gap-2">
        <span className="text-sm font-medium py-2">Rating:</span>
        {[1, 2, 3, 4].map(rating => (
          <Toggle
            key={`rating-${rating}`}
            pressed={isActive('rating', rating.toString())}
            onPressedChange={(pressed) => {
              updateFilter('rating', pressed ? rating.toString() : null)
            }}
            className="flex-1"
          >
            {'⭐'.repeat(rating)}
          </Toggle>
        ))}
      </div>
      
      <div className="flex flex-wrap gap-2">
        <span className="text-sm font-medium py-2">Price:</span>
        {[1, 2, 3, 4].map(price => (
          <Toggle
            key={`price-${price}`}
            pressed={isActive('price', price.toString())}
            onPressedChange={(pressed) => {
              updateFilter('price', pressed ? price.toString() : null)
            }}
            className="flex-1"
          >
            {'$'.repeat(price)}
          </Toggle>
        ))}
      </div>
    </div>
  )
}

function RestaurantCard({ restaurant }: { restaurant: RestaurantWithDetails }) {
  const fetcher = useFetcher()
  
  const isJoining = fetcher.state === 'submitting' && 
    fetcher.formData?.get('intent') === 'join'
  
  const isLeaving = fetcher.state === 'submitting' && 
    fetcher.formData?.get('intent') === 'leave'
  
  return (
    <Card className="overflow-hidden">
      <div className="relative h-40 bg-gray-200">
        {restaurant.photoRef ? (
          <img 
            src={`/resources/maps/photo?photoRef=${restaurant.photoRef}`}
            alt={restaurant.name}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gray-200">
            <span className="text-gray-400">No image</span>
          </div>
        )}
        
        <div className="absolute top-2 right-2 flex gap-2">
          {restaurant.rating ? (
            <span className="bg-white/90 text-black px-2 py-1 rounded-md text-sm flex items-center">
              <Star className="w-4 h-4 mr-1 text-yellow-500" />
              {restaurant.rating.toFixed(1)}
            </span>
          ) : null}
          
          {restaurant.priceLevel ? (
            <span className="bg-white/90 text-black px-2 py-1 rounded-md text-sm">
              {'$'.repeat(restaurant.priceLevel)}
            </span>
          ) : null}
        </div>
      </div>
      
      <CardHeader className="pb-2">
        <h3 className="font-bold text-lg">{restaurant.name}</h3>
      </CardHeader>
      
      <CardContent className="pb-2">
        <div className="flex items-center text-sm text-gray-500 mb-1">
          <MapPin className="w-4 h-4 mr-1" />
          <span>{restaurant.distance} mi</span>
        </div>
        
        {restaurant.mapsUrl && (
          <a 
            href={restaurant.mapsUrl} 
            target="_blank" 
            rel="noopener noreferrer"
            className="flex items-center text-sm text-blue-500 hover:underline"
          >
            <Map className="w-4 h-4 mr-1" />
            <span>Directions</span>
          </a>
        )}
        
        <div className="flex items-center text-sm mt-2">
          <Users className="w-4 h-4 mr-1" />
          <span>{restaurant.attendeeCount} attending</span>
        </div>
      </CardContent>
      
      <CardFooter>
        <fetcher.Form method="post" className="w-full">
          {restaurant.isUserAttending ? (
            <>
              <input type="hidden" name="intent" value="leave" />
              <StatusButton
                type="submit"
                status={isLeaving ? 'pending' : 'idle'}
                className="w-full"
                variant="destructive"
              >
                {isLeaving ? 'Leaving...' : 'Leave'}
              </StatusButton>
            </>
          ) : (
            <>
              <input type="hidden" name="intent" value="join" />
              <input type="hidden" name="restaurantId" value={restaurant.id} />
              <StatusButton
                type="submit"
                status={isJoining ? 'pending' : 'idle'}
                className="w-full"
              >
                {isJoining ? 'Joining...' : 'Join'}
              </StatusButton>
            </>
          )}
        </fetcher.Form>
      </CardFooter>
    </Card>
  )
} 