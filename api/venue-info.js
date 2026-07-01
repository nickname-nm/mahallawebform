const venueInfo = {
  name: 'MaHalla Berlin',
  description:
    'Industrial event venue and cultural space in Berlin with 9,000 m², 11 flexible spaces and capacity for up to 2,000 guests.',
  url: 'https://www.mahalla.berlin/venue',
  address: {
    streetAddress: 'Wilhelminenhofstraße 76',
    postalCode: '12459',
    addressLocality: 'Berlin',
    addressCountry: 'DE'
  },
  geo: {
    latitude: 52.4595943,
    longitude: 13.5228552
  },
  contact: {
    email: 'info@mahalla.berlin',
    bookingUrl: 'https://www.mahalla.berlin/venue'
  },
  capacity: {
    maximumGuests: 2000
  },
  spaces: {
    totalArea: '9,000 m²',
    count: 11
  },
  suitableFor: [
    'brand activations',
    'corporate events',
    'influencer events',
    'festivals',
    'concerts',
    'cultural productions',
    'weddings',
    'private events'
  ],
  socialProfiles: [
    'https://www.instagram.com/mahallaberlin/',
    'https://www.youtube.com/@MaHalla-Berlin'
  ]
}

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400')

  if (req.method === 'OPTIONS') {
    return res.status(204).end()
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  return res.status(200).json(venueInfo)
}
