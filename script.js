// script.js - Final Version with Conditional Checks, Robust Auth Logic, and OAuth Support

const menuBtn = document.getElementById("menu")
const header = document.getElementById("transparent")
const navLinks = document.querySelectorAll('.mobile-nav-menu a');

// --- Existing Header and Menu Toggle Logic (ONLY run if elements exist) ---

if (menuBtn && header) {
    window.addEventListener("scroll", ()=>{
        if (window.scrollY > 0) {
            header.classList.add("scrolled")
        }else{
            header.classList.remove("scrolled")
        }
    })
    
    function toggleMenu() {
        menuBtn.classList.toggle("active");
        document.body.classList.toggle("menu-open");
    }
    
    menuBtn.addEventListener("click", ()=>{
        toggleMenu();
    })
    
    navLinks.forEach(link => {
        link.addEventListener('click', () => {
            if (menuBtn.classList.contains("active")) {
                toggleMenu();
            }
        });
    });
}


// --- AUTHENTICATION & COMMENT LOGIC ---\r\n
const AUTH_TOKEN_KEY = 'miCommunityAuthToken';
const USERNAME_KEY = 'miCommunityUsername';
let currentPostId = null; // Stores the ID of the main post

// Helper to check if user is logged in
function isLoggedIn() {
    return localStorage.getItem(AUTH_TOKEN_KEY) !== null;
}

// Function to handle log out and UI cleanup
function handleLogout(event) {
    event.preventDefault();
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(USERNAME_KEY);
    // Redirect to home page after logout
    window.location.href = '/'; 
}

// Function to update the header login/logout link
function updateAuthUI() {
    // Note: The auth link element ID is missing in index.html snippet, assuming it's a class .auth-link
    const authLink = document.querySelector('.auth-link');
    if (authLink) {
        if (isLoggedIn()) {
            const username = localStorage.getItem(USERNAME_KEY) || 'User';
            authLink.textContent = `Log Out (${username})`;
            authLink.href = '#'; 
            authLink.addEventListener('click', handleLogout);

            updateCommentFormVisibility(true, username);
        } else {
            authLink.textContent = 'Log In';
            authLink.href = 'auth-form.html';
            authLink.removeEventListener('click', handleLogout);
            
            updateCommentFormVisibility(false);
        }
    }
}

// Function to show/hide the comment form on index.html
function updateCommentFormVisibility(isLoggedIn, username = '') {
    const commentFormArea = document.getElementById('comment-form-area');
    const loginPrompt = document.getElementById('login-prompt');
    const commentForm = document.getElementById('comment-form');
    
    if (commentFormArea && loginPrompt && commentForm) { // Check if we are on index.html
        if (isLoggedIn) {
            loginPrompt.style.display = 'none';
            commentForm.style.display = 'block';
            document.getElementById('comment-user-display').textContent = username;
        } else {
            loginPrompt.style.display = 'block';
            commentForm.style.display = 'none';
        }
    }
}

// Function to fetch and display comments
async function fetchComments(postId) {
    const commentsList = document.getElementById('comments-list');
    if (!commentsList) return; 

    try {
        const response = await fetch(`/api/comments/${postId}`);
        if (!response.ok) throw new Error('Failed to fetch comments.');
        
        const comments = await response.json();
        commentsList.innerHTML = ''; 

        if (comments.length === 0) {
            commentsList.innerHTML = '<p class="no-comments">No comments yet. Be the first to start the discussion!</p>';
            return;
        }

        comments.forEach(comment => {
            const commentDate = new Date(comment.date).toLocaleDateString();
            const commentHTML = `
                <div class="comment-item">
                    <p class="comment-author"><strong>${comment.username}</strong> <span class="comment-date">on ${commentDate}</span></p>
                    <p class="comment-content">${comment.content}</p>
                </div>
            `;
            commentsList.insertAdjacentHTML('beforeend', commentHTML);
        });

    } catch (error) {
        console.error('Error fetching comments:', error);
        commentsList.innerHTML = `<p class="error-message">Error loading comments: ${error.message}</p>`;
    }
}

// Function to handle comment submission
function handleCommentSubmit(event) {
    event.preventDefault();

    const commentContent = document.getElementById('comment-content').value;
    const commentMessage = document.getElementById('comment-message');

    if (!commentContent || !currentPostId) {
        commentMessage.textContent = 'Comment content cannot be empty.';
        commentMessage.style.color = 'red';
        return;
    }

    const token = localStorage.getItem(AUTH_TOKEN_KEY);
    if (!token) {
        commentMessage.textContent = 'You must be logged in to post a comment.';
        commentMessage.style.color = 'red';
        return;
    }

    fetch('/api/comments', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}` // Send the JWT
        },
        body: JSON.stringify({
            postId: currentPostId,
            content: commentContent
        })
    })
    .then(response => response.json().then(data => ({ status: response.status, body: data })))
    .then(result => {
        if (result.status === 201) {
            // Success
            document.getElementById('comment-content').value = ''; // Clear the input
            commentMessage.textContent = 'Comment posted successfully!';
            commentMessage.style.color = 'green';
            fetchComments(currentPostId); // Refresh comments
        } else {
            // Error
            commentMessage.textContent = result.body.message || 'Failed to post comment.';
            commentMessage.style.color = 'red';
        }
    })
    .catch(error => {
        console.error('Comment Submission Error:', error);
        commentMessage.textContent = 'Network error. Could not post comment.';
        commentMessage.style.color = 'red';
    });
}


// Function to fetch the single main post and initialize comments
async function fetchAndRenderMainPost() {
    const postContainer = document.getElementById('main-post-container');
    const commentFormElement = document.getElementById('comment-form');

    if (!postContainer) return; // Exit if we are not on index.html

    try {
        const response = await fetch('/api/posts/single');
        if (!response.ok) throw new Error('Could not fetch the main discussion post.');
        
        const post = await response.json();
        currentPostId = post._id; // Store the ID globally

        // NOTE: I am assuming your post content is in a minimal format without full HTML structure,
        // so I am using innerHTML for simplicity.
        const postHTML = `
            <h2>${post.title}</h2>
            <p class="post-meta">Posted by <strong>${post.author}</strong> on ${new Date(post.date).toLocaleDateString()}</p>
            <p>${post.content}</p>
        `;
        postContainer.innerHTML = postHTML;

        // Fetch comments after getting the post ID
        fetchComments(currentPostId);

        // Add event listener to comment form once the page is confirmed
        if (commentFormElement) {
            commentFormElement.addEventListener('submit', handleCommentSubmit);
        }

    } catch (error) {
        console.error('Error loading post:', error);
        postContainer.innerHTML = `<h2 class="error-message">Error loading post. ${error.message}. Check server connection.</h2>`;
        // Hide the comment section on error
        const commentArea = document.getElementById('comment-section');
        if (commentArea) commentArea.style.display = 'none';
    }
}


// --- Authentication Page Logic (FOR auth-form.html) ---

const authForm = document.getElementById('auth-form-body');
if (authForm) {
    // 1. Tab Switching Logic (Original logic restored/kept)
    const loginTab = document.getElementById('login-tab');
    const signupTab = document.getElementById('signup-tab');
    const loginFields = document.getElementById('login-fields');
    const signupFields = document.getElementById('signup-fields');
    const submitButton = document.getElementById('submit-button');
    let isLoginMode = true;

    function switchMode(toLogin) {
        isLoginMode = toLogin;
        if (toLogin) {
            loginTab.classList.add('active');
            signupTab.classList.remove('active');
            loginFields.style.display = 'block';
            signupFields.style.display = 'none';
            submitButton.textContent = 'Log In';
        } else {
            loginTab.classList.remove('active');
            signupTab.classList.add('active');
            loginFields.style.display = 'none';
            signupFields.style.display = 'block';
            submitButton.textContent = 'Sign Up';
        }
    }

    // Default to login on load
    switchMode(true); 

    if (loginTab) {
        loginTab.addEventListener('click', () => switchMode(true));
        signupTab.addEventListener('click', () => switchMode(false));
    }


    // 2. Submission Logic for Email/Password
    authForm.addEventListener('submit', async (event) => {
        event.preventDefault();

        const authMessage = document.getElementById('auth-message');
        authMessage.textContent = 'Processing...';
        authMessage.style.color = '#333';

        let endpoint, payload;

        if (isLoginMode) {
            // LOGIN mode
            endpoint = '/api/auth/login';
            payload = {
                email: document.getElementById('email-login').value,
                password: document.getElementById('password-login').value,
            };
        } else {
            // SIGNUP mode
            endpoint = '/api/auth/register';
            payload = {
                username: document.getElementById('username').value,
                email: document.getElementById('email-signup').value,
                password: document.getElementById('password-signup').value,
            };
        }

        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            let data = {};
            try {
                // Ensure data is parsed, even if status is not 200
                data = await response.json(); 
            } catch (e) {
                // Handle non-JSON responses (e.g., if server crashed)
                data.message = 'A server error occurred. Please check the server terminal for crash logs.';
            }

            if (response.ok) {
                authMessage.textContent = data.message;
                authMessage.style.color = 'green';
                
                if (isLoginMode) {
                    // Store token and username on successful login (for both traditional and OAuth API usage)
                    localStorage.setItem(AUTH_TOKEN_KEY, data.token);
                    localStorage.setItem(USERNAME_KEY, data.username);
                    // Redirect back to the home page
                    setTimeout(() => { window.location.href = '/'; }, 1000); 
                } else {
                    // After successful registration, switch to login tab
                    setTimeout(() => { 
                        switchMode(true); 
                        authMessage.textContent = 'Registration successful! Please log in.';
                        authMessage.style.color = 'green';
                    }, 1000);
                }
            } else {
                authMessage.textContent = data.message || `An unexpected error occurred (Status: ${response.status}).`;
                authMessage.style.color = 'red';
            }

        } catch (error) {
            console.error('Network Error:', error);
            authMessage.textContent = 'Network error. Could not reach server.';
            authMessage.style.color = 'red';
        }
    });

    // NOTE: Social login buttons are now handled by direct links (like Google) 
    // or are non-functional placeholders. No custom JS submission required here.
}


// --- Initialization ---\r\n

window.addEventListener('load', () => {
    // 1. Initial UI update for index.html (log in/out button, comment form visibility)
    updateAuthUI(); 

    // 2. Fetch and render the main post and its comments (only on index.html)
    fetchAndRenderMainPost();

    // 3. Existing Scroll Reveal Code
    const revealElements = document.querySelectorAll('.reveal');
    const observerOptions = {
        root: null,
        rootMargin: '0px',
        threshold: 0.2 
    };
    const observer = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('active');
            }
        });
    }, observerOptions);

    revealElements.forEach(element => {
        observer.observe(element);
    });

    // 4. Code for dynamic copyright year
    const currentYearElement = document.getElementById('current-year');
    if (currentYearElement) {
        currentYearElement.textContent = new Date().getFullYear();
    }
});