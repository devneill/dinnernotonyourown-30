import { faker } from '@faker-js/faker'
import { HttpResponse, http, type HttpHandler } from 'msw'

const { json } = HttpResponse

// Mock restaurant data
const mockRestaurants = Array.from({ length: 20 }, (_, i) => {
  const id = `place_id_${i}`
  const priceLevel = faker.helpers.arrayElement([1, 2, 3, 4, null])
  const rating = faker.number.float({ min: 1, max: 5, fractionDigits: 1 })
  
  return {
    place_id: id,
    name: faker.company.name() + ' ' + faker.helpers.arrayElement(['Restaurant', 'Cafe', 'Bistro', 'Grill', 'Diner']),
    price_level: priceLevel,
    rating: rating,
    geometry: {
      location: {
        lat: 40.7596 + (Math.random() * 0.02 - 0.01), // Around Hilton coordinates
        lng: -111.8867 + (Math.random() * 0.02 - 0.01)
      }
    },
    vicinity: faker.location.streetAddress(),
    photos: [
      {
        photo_reference: `photo_ref_${id}`
      }
    ]
  }
})

export const handlers: Array<HttpHandler> = [
  // Nearby Search API
  http.get('https://maps.googleapis.com/maps/api/place/nearbysearch/json', ({ request }) => {
    const url = new URL(request.url)
    const location = url.searchParams.get('location')
    const radius = url.searchParams.get('radius')
    const type = url.searchParams.get('type')
    
    if (!location || !radius || type !== 'restaurant') {
      return json({
        status: 'INVALID_REQUEST',
        error_message: 'Missing required parameters or invalid type'
      })
    }
    
    return json({
      results: mockRestaurants,
      status: 'OK'
    })
  }),
  
  // Place Details API
  http.get('https://maps.googleapis.com/maps/api/place/details/json', ({ request }) => {
    const url = new URL(request.url)
    const placeId = url.searchParams.get('place_id')
    
    if (!placeId) {
      return json({
        status: 'INVALID_REQUEST',
        error_message: 'Missing place_id parameter'
      })
    }
    
    const restaurant = mockRestaurants.find(r => r.place_id === placeId)
    
    if (!restaurant) {
      return json({
        status: 'NOT_FOUND',
        error_message: 'Place not found'
      })
    }
    
    return json({
      result: {
        url: `https://maps.google.com/?cid=${placeId.replace('place_id_', '')}`,
        photos: restaurant.photos
      },
      status: 'OK'
    })
  }),
  
  // Photo API (this is handled by our own endpoint, but we'll mock it for completeness)
  http.get('/resources/maps/photo', () => {
    // Return a placeholder image
    return new HttpResponse(null, {
      status: 302,
      headers: {
        Location: 'https://via.placeholder.com/400x300'
      }
    })
  })
] 