import { invariant } from '@epic-web/invariant'

type LatLng = {
  lat: number
  lng: number
}

type NearbySearchParams = {
  lat: number
  lng: number
  radius: number // in meters
}

type NearbySearchResponse = {
  results: Array<{
    place_id: string
    name: string
    price_level?: number
    rating?: number
    geometry: {
      location: {
        lat: number
        lng: number
      }
    }
    vicinity: string
    photos?: Array<{
      photo_reference: string
    }>
  }>
  status: string
}

type PlaceDetailsResponse = {
  result: {
    url?: string
    photos?: Array<{
      photo_reference: string
    }>
  }
  status: string
}

type RestaurantData = {
  id: string
  name: string
  priceLevel: number | null
  rating: number | null
  lat: number
  lng: number
  photoRef: string | null
  mapsUrl: string | null
}

/**
 * Fetches nearby restaurants from Google Places API
 */
export async function getNearbyRestaurants({
  lat,
  lng,
  radius,
}: NearbySearchParams): Promise<RestaurantData[]> {
  invariant(process.env.GOOGLE_PLACES_API_KEY, 'GOOGLE_PLACES_API_KEY is required')
  
  // Make the initial Nearby Search request
  const nearbySearchUrl = new URL('https://maps.googleapis.com/maps/api/place/nearbysearch/json')
  nearbySearchUrl.searchParams.append('location', `${lat},${lng}`)
  nearbySearchUrl.searchParams.append('radius', radius.toString())
  nearbySearchUrl.searchParams.append('type', 'restaurant')
  nearbySearchUrl.searchParams.append('key', process.env.GOOGLE_PLACES_API_KEY)
  
  const nearbySearchResponse = await fetch(nearbySearchUrl.toString())
  const nearbySearchData = (await nearbySearchResponse.json()) as NearbySearchResponse
  
  if (nearbySearchData.status !== 'OK' && nearbySearchData.status !== 'ZERO_RESULTS') {
    throw new Error(`Google Places API error: ${nearbySearchData.status}`)
  }
  
  if (nearbySearchData.status === 'ZERO_RESULTS' || !nearbySearchData.results.length) {
    return []
  }
  
  // For each restaurant, get additional details
  const restaurantsWithDetails = await Promise.all(
    nearbySearchData.results.map(async (place) => {
      // Get place details for additional info
      const placeDetailsUrl = new URL('https://maps.googleapis.com/maps/api/place/details/json')
      placeDetailsUrl.searchParams.append('place_id', place.place_id)
      placeDetailsUrl.searchParams.append('fields', 'url,photos')
      placeDetailsUrl.searchParams.append('key', process.env.GOOGLE_PLACES_API_KEY)
      
      const placeDetailsResponse = await fetch(placeDetailsUrl.toString())
      const placeDetailsData = (await placeDetailsResponse.json()) as PlaceDetailsResponse
      
      // Transform data to match our database schema
      return {
        id: place.place_id,
        name: place.name,
        priceLevel: place.price_level ?? null,
        rating: place.rating ?? null,
        lat: place.geometry.location.lat,
        lng: place.geometry.location.lng,
        photoRef: 
          place.photos?.[0]?.photo_reference || 
          placeDetailsData.result.photos?.[0]?.photo_reference || 
          null,
        mapsUrl: placeDetailsData.result.url || null,
      }
    })
  )
  
  return restaurantsWithDetails
} 