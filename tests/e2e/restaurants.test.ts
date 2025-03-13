import { expect, test } from '@playwright/test'
import { createUser, createPassword } from '../db-utils.ts'
import { prisma } from '#app/utils/db.server.ts'
import { faker } from '@faker-js/faker'

test.describe('Restaurants page', () => {
  let user: { id: string; email: string; username: string }
  let userPassword: string
  
  test.beforeEach(async ({ page }) => {
    // Create a test user
    const userData = createUser()
    userPassword = faker.internet.password()
    const passwordHash = createPassword(userPassword)
    
    user = await prisma.user.create({
      data: {
        ...userData,
        password: {
          create: passwordHash,
        },
      },
      select: {
        id: true,
        email: true,
        username: true,
      },
    })
    
    // Login
    await page.goto('/login')
    await page.fill('input[name="username"]', userData.username)
    await page.fill('input[name="password"]', userPassword)
    await page.click('button[type="submit"]')
    await page.waitForURL(`/users/${userData.username}`)
    
    // Navigate to restaurants page
    await page.goto(`/users/${userData.username}/restaurants`)
    await page.waitForSelector('h1:has-text("Find Restaurants")')
  })
  
  test.afterEach(async () => {
    // Clean up any attendees created by the test
    await prisma.attendee.deleteMany({
      where: { userId: user.id },
    })
  })
  
  test('displays restaurants and filters work', async ({ page }) => {
    // Check that restaurants are displayed
    await expect(page.locator('.grid-cols-1 > div').first()).toBeVisible()
    
    // Test distance filter
    await page.click('text=2mi')
    await expect(page).toHaveURL(/.*distance=2.*/)
    
    // Test rating filter
    await page.click('text=⭐⭐⭐')
    await expect(page).toHaveURL(/.*rating=3.*/)
    
    // Test price filter
    await page.click('text=$$')
    await expect(page).toHaveURL(/.*price=2.*/)
    
    // Clear filters one by one
    await page.click('text=2mi') // Unselect distance
    await expect(page).not.toHaveURL(/.*distance=2.*/)
    
    await page.click('text=⭐⭐⭐') // Unselect rating
    await expect(page).not.toHaveURL(/.*rating=3.*/)
    
    await page.click('text=$$') // Unselect price
    await expect(page).not.toHaveURL(/.*price=2.*/)
  })
  
  test('can join and leave a restaurant', async ({ page }) => {
    // Initially, user should not be attending any restaurant
    await expect(page.locator('text="Leave"')).toHaveCount(0)
    
    // Join the first restaurant
    await page.locator('button:has-text("Join")').first().click()
    
    // Wait for the button to change to "Leave"
    await expect(page.locator('button:has-text("Leave")').first()).toBeVisible()
    
    // Check that the restaurant appears in the "Dinner Plans" section
    await expect(page.locator('h2:has-text("Dinner Plans") + div div')).toBeVisible()
    
    // Leave the restaurant
    await page.locator('button:has-text("Leave")').click()
    
    // Wait for the button to change back to "Join"
    await expect(page.locator('button:has-text("Join")').first()).toBeVisible()
    
    // Check that the "Dinner Plans" section is empty
    await expect(page.locator('text="Everyone is having dinner on their own 🥲"')).toBeVisible()
  })
  
  test('can only join one restaurant at a time', async ({ page }) => {
    // Join the first restaurant
    await page.locator('button:has-text("Join")').first().click()
    await expect(page.locator('button:has-text("Leave")').first()).toBeVisible()
    
    // Try to join another restaurant
    const secondRestaurantJoinButton = page.locator('button:has-text("Join")').first()
    await secondRestaurantJoinButton.click()
    
    // The first restaurant should no longer show "Leave"
    await expect(page.locator('button:has-text("Leave")').first()).toBeVisible()
    await expect(page.locator('button:has-text("Leave")').count()).toBe(1)
    
    // Clean up
    await page.locator('button:has-text("Leave")').click()
    await expect(page.locator('button:has-text("Join")').first()).toBeVisible()
  })
}) 