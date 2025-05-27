const puppeteer = require('puppeteer');
const axios = require('axios');

// Hardcoded next-action ID (as requested)
const NEXT_ACTION_ID = '28417b2a8c56565e7953dccc20653cea74746d3a';

const config = {
    selectors: {
        book: {
            title: '.detailsBookContainer_bookName__pLCtW',
            summary: '.productSummary_summeryText__Pd_tX', // Assuming this is for books
            mainImage: '.lookInside_imageContainer__A2WcA img', 
            listImages: '.bookImageThumbs_bookImageThumb__368gC img', 
            // Note: specificationSummary selector is not needed here as we get it from API
        },
        // We might need product selectors if you plan to scrape general product pages too
        product: { // Assuming these are fallbacks or for non-book product pages
            title: '.mb-0.title, .details-book-main__title, .product-title__title',
            summary: '.details-ql-editor.ql-editor.summary, .details-book-additional__content-pane', 
            // mainImage for product might need different logic (e.g., background-image)
            // listImagesContainer for product: 'li.js--list-img', 
        }
    },
    targetDimensions: '260X372', // From your UserScript for image URL modification
    regex: {
        dimensionPart: /(\/(?:ProductNew\d+|product|book|Content)\/)\d+X\d+(\/.*)/i
    }
};

function getBookIdFromUrl(url) {
    try {
        const match = url.match(/\/book\/(\d+)\//);
        return match ? match[1] : null;
    } catch (e) {
        console.error('Error extracting book ID from URL:', e);
        return null;
    }
}

// Re-implementing your UserScript's image URL modification logic in Node.js
function modifyUrlToTargetDimensions(url, targetDimensions, dimensionRegex) {
    if (!url || typeof url !== 'string') {
        return url;
    }
    try {
        const match = url.match(dimensionRegex);
        if (match && match[1] && match[2]) {
            const currentDimensionInUrl = url.substring(url.indexOf(match[1]) + match[1].length, url.indexOf(match[2]));
            if (currentDimensionInUrl.toUpperCase() === targetDimensions.toUpperCase()) {
                return url;
            }
            const baseUrlPart = url.substring(0, url.indexOf(match[1]));
            return baseUrlPart + match[1] + targetDimensions + match[2];
        }
    } catch (e) {
        console.error(`Error modifying URL "${url}":`, e);
    }
    return url;
}

async function fetchSpecifications(bookUrl, bookId) {
    if (!bookId) {
        console.warn('No book ID provided for fetching specifications.');
        return null;
    }

    const payload = JSON.stringify([bookId]); // Payload is ["BOOK_ID"]

    const headers = {
        'accept': 'text/x-component',
        'accept-language': 'en-US,en;q=0.9',
        'content-type': 'text/plain;charset=UTF-8',
        'next-action': NEXT_ACTION_ID,
        'origin': 'https://www.rokomari.com',
        'referer': bookUrl,
        // It's important to use a realistic User-Agent
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        // Cookies might be necessary. This is a complex part.
        // For now, we omit them, but if the request fails, this is a key area to investigate.
        // 'cookie': 'your_cookie_string_here' 
    };

    try {
        console.log(`Fetching specifications via API for book ID: ${bookId}...`);
        const response = await axios.post(bookUrl, payload, { headers });
        
        // The response structure you provided: 0: [someId, null], 1: [{key:val}, ...]
        // We are interested in the second element of the outer array, which is an array of spec objects.
        if (response.data && Array.isArray(response.data) && response.data.length > 1 && Array.isArray(response.data[1])) {
             // The actual specification data seems to be in response.data[1]
            const specs = response.data[1];
            console.log('Successfully fetched and parsed specifications from API.');
            return specs;
        } else {
            console.warn('Unexpected response structure from specifications API:', response.data);
            return null;
        }
    } catch (error) {
        console.error(`Error fetching specifications from API for book ID ${bookId}:`);
        if (error.response) {
            console.error('Status:', error.response.status);
            console.error('Headers:', JSON.stringify(error.response.headers, null, 2));
            console.error('Data:', error.response.data); // This might be HTML if the request was redirected or errored out
        } else if (error.request) {
            console.error('No response received:', error.request);
        } else {
            console.error('Error setting up request:', error.message);
        }
        return null;
    }
}

async function scrapeRokomariBook(url) {
    let browser;
    const bookId = getBookIdFromUrl(url);
    let allData = { url, bookId, title: null, summary: null, mainImage: null, listImages: [], specifications: null, error: null };

    try {
        console.log(`Launching headless browser for initial page data...`);
        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        console.log(`Navigating to ${url} with Puppeteer...`);
        await page.goto(url, { waitUntil: 'networkidle2' });

        // Determine selectors based on page type (assuming 'book' for now)
        const currentSelectors = config.selectors.book; // Simplified for this example

        // Extract Title
        try {
            allData.title = await page.$eval(currentSelectors.title, el => el.textContent.trim());
            console.log(`Title (Puppeteer): ${allData.title}`);
        } catch (e) { console.error(`Could not extract title with Puppeteer: ${e.message}`); }

        // Extract Summary
        try {
            allData.summary = await page.$eval(currentSelectors.summary, el => el.textContent.trim());
            console.log(`Summary (Puppeteer): ${(allData.summary || '').substring(0,100)}...`);
        } catch (e) { console.error(`Could not extract summary with Puppeteer: ${e.message}`); }

        // Extract Main Image
        try {
            const rawMainImageUrl = await page.$eval(currentSelectors.mainImage, el => el.src || el.dataset.src);
            allData.mainImage = modifyUrlToTargetDimensions(rawMainImageUrl, config.targetDimensions, config.regex.dimensionPart);
            console.log(`Main Image (Puppeteer, Modified): ${allData.mainImage}`);
        } catch (e) { console.error(`Could not extract main image with Puppeteer: ${e.message}`); }
        
        // Extract List Images
        try {
            const rawListImageUrls = await page.$$eval(currentSelectors.listImages, imgs => imgs.map(img => img.src || img.dataset.src));
            allData.listImages = rawListImageUrls
                .map(src => modifyUrlToTargetDimensions(src, config.targetDimensions, config.regex.dimensionPart))
                .filter(src => src);
            console.log(`List Images (Puppeteer, Modified): ${allData.listImages.length} found`);
        } catch (e) { console.error(`Could not extract list images with Puppeteer: ${e.message}`); }

        if (browser) {
            await browser.close();
            console.log('Browser closed after initial data extraction.');
        }

        // Fetch specifications using Axios
        if (bookId) {
            allData.specifications = await fetchSpecifications(url, bookId);
        }

    } catch (error) {
        console.error(`An error occurred during the overall scraping process for ${url}: ${error.message}`);
        allData.error = error.message;
        if (browser) {
            await browser.close(); // Ensure browser is closed on error
        }
    }
    return allData;
}

// --- Example Usage ---
(async () => {
    const bookUrl = process.argv[2] || 'https://www.rokomari.com/book/48659/masud-rana-hacker-1-and-2';

    if (!bookUrl || !bookUrl.startsWith('http')) {
        console.error("Please provide a valid Rokomari book URL.");
        console.log("Example: node scrape.js https://www.rokomari.com/book/some-book-id/book-name");
        return;
    }

    console.log(`Starting full scrape for: ${bookUrl}`);
    const productData = await scrapeRokomariBook(bookUrl);

    console.log("\n--- Combined Extracted Data ---");
    console.log(JSON.stringify(productData, null, 2));
})(); 