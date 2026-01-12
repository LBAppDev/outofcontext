import express from "express";
import http from "http";
import cors from "cors"; // Import cors
import { v4 as uuidv4 } from 'uuid'; // For generating unique player IDs

const app = express();
const server = http.createServer(app);

// Use cors middleware to allow requests from your React app
app.use(cors({ origin: "*" })); // Allow all origins for development
app.use(express.json()); // To parse JSON request bodies

const rooms = {}; // Stores game state for each room

const WORDS = [
    "Cat", "Dog", "Elephant", "Lion", "Monkey", "Rabbit", "Chicken", "Horse", "Shark", "Eagle",
"Tiger", "Wolf", "Fox", "Bear", "Deer", "Giraffe", "Zebra", "Kangaroo", "Panda", "Dolphin",
"Whale", "Penguin", "Crocodile", "Snake", "Frog", "Turtle", "Parrot", "Owl", "Peacock", "Camel",
"Goat", "Sheep", "Cow", "Pig", "Mouse", "Rat", "Squirrel", "Hedgehog", "Bee", "Butterfly"
];

const GAME_SETTINGS = {
    MAX_ROUNDS: 3,
    // With polling, round timers are more conceptual or client-driven.
    // Server won't actively end rounds, client requests will drive state changes.
};

// Helper function to get player info suitable for sending to clients (no secrets)
function getSanitizedPlayers(roomCode) {
    const room = rooms[roomCode];
    if (!room) return [];
    return room.players.map(p => ({
        id: p.id,
        name: p.name,
        score: p.score,
        isHost: p.isHost,
        // role and word are secret, not sent in this general list
    }));
}

// Helper to send a chat message (to be included in the next poll)
function addChatMessage(roomCode, name, msg) {
    const room = rooms[roomCode];
    if (room) {
        room.chat.push({ name, msg, timestamp: Date.now() });
        // Keep chat history to a reasonable limit
        if (room.chat.length > 50) {
            room.chat.shift();
        }
    }
}


// --- API Endpoints ---

// 1. Join Room / Get Initial State
app.post("/api/join-room", (req, res) => {
    const { name, room: roomCode } = req.body;
    if (!name || !roomCode) {
        return res.status(400).json({ error: "Name and room code are required." });
    }

    let playerFound = false;
    let newPlayerId = uuidv4(); // Generate a new ID for a new player

    if (!rooms[roomCode]) {
        rooms[roomCode] = {
            players: [],
            word: "",
            spy: "",
            gameStarted: false,
            currentRound: 0,
            roundState: "waiting", // waiting, playing, voting, ended
            votes: {}, // { voterId: targetPlayerId }
            chat: [],
            discussionTurnsString: "",
            lastUpdateTimestamp: Date.now(), // To help client know if state changed
        };
        console.log(`Room ${roomCode} created.`);
    }

    const room = rooms[roomCode];

    // Check if player with this name already exists in the room
    // For HTTP, we can't rely on socket.id. We'll use a unique ID generated for the client.
    // The client will send this ID on subsequent requests.
    // For simplicity, let's assume if player with same name tries to join, they get a new ID.
    // A more robust solution would involve session management or JWTs.

    const isHost = room.players.length === 0;
    const player = { id: newPlayerId, name, score: 0, isHost, role: null, word: null };
    room.players.push(player);
    room.lastUpdateTimestamp = Date.now();

    addChatMessage(roomCode, "Server", `${name} has joined the room.`);
    console.log(`${name} (id: ${newPlayerId}) joined room ${roomCode}. Host: ${isHost}`);

    return res.status(200).json({
        message: "Joined room successfully.",
        playerId: newPlayerId,
        roomState: {
            gameStarted: room.gameStarted,
            currentRound: room.currentRound,
            roundState: room.roundState,
            players: getSanitizedPlayers(roomCode),
            myRole: player.role, // This will be null initially
            myWord: player.word, // This will be null initially
            chat: room.chat,
            discussionTurnsString: room.discussionTurnsString,
            lastUpdateTimestamp: room.lastUpdateTimestamp,
        },
    });
});

// 2. Get Room State (Polling Endpoint)
app.get("/api/room/:roomCode/state/:playerId", (req, res) => {
    const { roomCode, playerId } = req.params;
    const room = rooms[roomCode];

    if (!room) {
        return res.status(404).json({ error: "Room not found." });
    }

    const player = room.players.find(p => p.id === playerId);
    if (!player) {
        // Player not found, they might have been disconnected or joined with a new ID
        // For simplicity, we just return an error. In a real game, might kick them.
        return res.status(401).json({ error: "Player not in this room. Please re-join." });
    }

    // Only send the specific player's role/word to that player
    return res.status(200).json({
        gameStarted: room.gameStarted,
        currentRound: room.currentRound,
        roundState: room.roundState,
        players: getSanitizedPlayers(roomCode),
        myRole: player.role, // Only sent to the requesting player
        myWord: player.word, // Only sent to the requesting player
        chat: room.chat,
        lastUpdateTimestamp: room.lastUpdateTimestamp,
    });
});

// 3. Start Game
app.post("/api/room/:roomCode/start-game", (req, res) => {
    const { roomCode } = req.params;
    const { playerId } = req.body; // Need player ID to verify host
    const room = rooms[roomCode];

    if (!room) return res.status(404).json({ error: "Room not found." });
    const player = room.players.find(p => p.id === playerId);
    if (!player || !player.isHost) {
        return res.status(403).json({ error: "Only the host can start the game." });
    }
    if (room.gameStarted) {
        return res.status(400).json({ error: "Game already started." });
    }
    if (room.players.length < 2) {
        return res.status(400).json({ error: "Need at least 2 players to start a game." });
    }

    room.gameStarted = true;
    room.currentRound = 1;
    addChatMessage(roomCode, "Server", "Game is starting!");
    assignRolesAndWord(roomCode); // Start the first round
    room.lastUpdateTimestamp = Date.now(); // Mark state as updated
    return res.status(200).json({ message: "Game started." });
});

// 4. Send Chat Message
app.post("/api/room/:roomCode/chat", (req, res) => {
    const { roomCode } = req.params;
    const { name, msg } = req.body;
    const room = rooms[roomCode];

    if (!room) return res.status(404).json({ error: "Room not found." });
    if (!name || !msg) return res.status(400).json({ error: "Name and message are required." });

    addChatMessage(roomCode, name, msg);
    room.lastUpdateTimestamp = Date.now(); // Mark state as updated
    return res.status(200).json({ message: "Message sent." });
});

// 5. Start Vote
app.post("/api/room/:roomCode/start-vote", (req, res) => {
    const { roomCode } = req.params;
    const { playerId } = req.body;
    const room = rooms[roomCode];

    if (!room) return res.status(404).json({ error: "Room not found." });
    const player = room.players.find(p => p.id === playerId);
    if (!player || !player.isHost) {
        return res.status(403).json({ error: "Only the host can start the vote." });
    }
    if (room.roundState !== "playing") {
        return res.status(400).json({ error: "Voting can only start during the playing phase." });
    }

    room.roundState = "voting";
    room.votes = {}; // Reset votes
    addChatMessage(roomCode, "Server", "Voting has started! Vote for who you think is the spy.");
    room.lastUpdateTimestamp = Date.now();
    return res.status(200).json({ message: "Voting started." });
});

// 6. Cast Vote
app.post("/api/room/:roomCode/cast-vote", (req, res) => {
    const { roomCode } = req.params;
    const { voterId, targetPlayerId } = req.body;
    const room = rooms[roomCode];

    if (!room || room.roundState !== "voting") {
        return res.status(400).json({ error: "Voting is not active." });
    }

    const voter = room.players.find(p => p.id === voterId);
    const target = room.players.find(p => p.id === targetPlayerId);

    if (!voter || !target) {
        return res.status(400).json({ error: "Invalid voter or target player." });
    }
    if (voter.id === target.id) {
        return res.status(400).json({ error: "You cannot vote for yourself." });
    }

    room.votes[voter.id] = target.id;
    addChatMessage(roomCode, "Server", `${voter.name} has cast a vote.`);
    room.lastUpdateTimestamp = Date.now();
    return res.status(200).json({ message: "Vote cast successfully." });
});

// 7. End Vote / Round (Host-triggered or via a separate 'auto-end' mechanism)
app.post("/api/room/:roomCode/end-round", (req, res) => {
    const { roomCode } = req.params;
    const { playerId } = req.body; // Host ID to verify
    const room = rooms[roomCode];

    if (!room || room.roundState !== "voting") {
        return res.status(400).json({ error: "Cannot end round: Voting is not active or game not started." });
    }
    const player = room.players.find(p => p.id === playerId);
    if (!player || !player.isHost) {
        return res.status(403).json({ error: "Only the host can end the round." });
    }

    room.roundState = "ended";
    let message = "Voting ended.";

    // Calculate votes
    let voteCounts = {}; // { targetPlayerId: count }
    // Store who voted for whom to award points
    let playerVotes = {}; // { voterId: targetPlayerId }

    for (const voterId in room.votes) {
        const targetId = room.votes[voterId];
        voteCounts[targetId] = (voteCounts[targetId] || 0) + 1;
        playerVotes[voterId] = targetId; // Keep track of each player's vote
    }

    let mostVotedPlayerId = null;
    let maxVotes = 0;
    // Check for ties in most voted players
    let tiedPlayers = [];

    for (const pId in voteCounts) {
        if (voteCounts[pId] > maxVotes) {
            maxVotes = voteCounts[pId];
            mostVotedPlayerId = pId;
            tiedPlayers = [pId]; // Start new tie group
        } else if (voteCounts[pId] === maxVotes && maxVotes > 0) {
            tiedPlayers.push(pId); // Add to tie group
        }
    }

    // Determine if the spy was caught
    const totalPlayers = room.players.length;
    const playersWhoVoted = Object.keys(playerVotes).length;
    const spyPlayer = room.players.find(p => p.id === room.spy);
    const spyName = spyPlayer ? spyPlayer.name : "the spy";

    let spyCaught = false;

    if (mostVotedPlayerId && tiedPlayers.includes(room.spy) && tiedPlayers.length === 1) {
         // Spy was the unique most voted player
         spyCaught = true;
         message += ` Most voted: ${spyName} with ${maxVotes} votes.`;
    } else if (mostVotedPlayerId && tiedPlayers.includes(room.spy) && tiedPlayers.length > 1) {
        // Spy was among the most voted, but it was a tie.
        // For simplicity, if there's a tie, and the spy is in it, we'll consider them "caught"
        // by the group, but this might need further refinement based on specific game rules
        // e.g., if you only want the spy caught if they are *uniquely* the most voted.
        // For now, let's say a tie where spy is in it counts as caught.
        spyCaught = true;
        message += ` Most voted (tie): ${tiedPlayers.map(id => room.players.find(p => p.id === id)?.name || "Unknown").join(', ')}.`;
    } else if (mostVotedPlayerId) {
        const votedOutPlayer = room.players.find(p => p.id === mostVotedPlayerId);
        message += ` Most voted: ${votedOutPlayer?.name || "Unknown Player"} with ${maxVotes} votes.`;
    } else {
        message += " No votes cast or a complete tie (everyone voted for someone different, no single majority).";
    }

    // --- Apply New Scoring Logic ---
    room.players.forEach(p => {
        p.roundScore = 0; // Initialize round score for this round

        // 1. Civilian Scoring: 1 point if they voted for the actual spy
        if (p.role === "civilian") {
            if (playerVotes[p.id] === room.spy) {
                p.score += 1;
                p.roundScore = 1;
                addChatMessage(roomCode, "Server", `${p.name} correctly voted for the spy and gets 1 point!`);
            } else {
                addChatMessage(roomCode, "Server", `${p.name} did not vote for the spy.`);
            }
        }
    });

    // 2. Spy Scoring: 0 if caught (half or more caught him), else 1 point
    if (spyPlayer) { // Ensure spyPlayer exists
        let votesAgainstSpy = voteCounts[room.spy] || 0;
        let minimumVotesToCatchSpy = Math.ceil(totalPlayers / 2); // Half or more players

        if (votesAgainstSpy >= minimumVotesToCatchSpy) {
            // Spy was caught
            spyCaught = true; // Reinforce spyCaught flag
            message += ` The spy (${spyName}) was caught with ${votesAgainstSpy} votes (${votesAgainstSpy} >= ${minimumVotesToCatchSpy} votes required)!`;
            addChatMessage(roomCode, "Server", `${spyName} (the spy) was caught! No point for the spy this round.`);
            // Spy gets 0 points (no score modification needed as default is 0)
        } else {
            // Spy was NOT caught (less than half caught him)
            spyCaught = false; // Reinforce spyCaught flag
            spyPlayer.score += 1; // Spy gets 1 point
            spyPlayer.roundScore = 1;
            message += ` The spy (${spyName}) escaped! Only ${votesAgainstSpy} votes were against them (less than ${minimumVotesToCatchSpy} required). Spy gets 1 point!`;
            addChatMessage(roomCode, "Server", `${spyName} (the spy) escaped and gets 1 point!`);
        }
        message += ` The word was: ${room.word}.`;
    }


    addChatMessage(roomCode, "Server", message);
    room.lastRoundResult = message; // Store for client to display

    // Check if game is over
    if (room.currentRound >= GAME_SETTINGS.MAX_ROUNDS) {
        addChatMessage(roomCode, "Server", "Game Over! Final Scores:");
        room.players.sort((a, b) => b.score - a.score).forEach(p => {
            addChatMessage(roomCode, "Server", `${p.name}: ${p.score} points`);
        });
        resetGame(roomCode); // Reset for next game
    } else {
        // Prepare for next round
        room.currentRound++;
        addChatMessage(roomCode, "Server", `Starting Round ${room.currentRound}...`);
        assignRolesAndWord(roomCode); // Start next round
    }
    room.lastUpdateTimestamp = Date.now();
    return res.status(200).json({ message: "Round ended." });
});


// --- Helper Functions for Server Logic ---

function assignRolesAndWord(roomCode) {
    const room = rooms[roomCode];
    if (!room || room.players.length < 2) {
        addChatMessage(roomCode, "Server", "Not enough players to assign roles. Resetting game.");
        resetGame(roomCode);
        return;
    }

    const randomWord = WORDS[Math.floor(Math.random() * WORDS.length)];
    const spyIndex = Math.floor(Math.random() * room.players.length);

    room.word = randomWord;
    room.spy = room.players[spyIndex].id;

    room.players.forEach((p) => {
        p.role = (p.id === room.spy) ? "spy" : "civilian";
        p.word = (p.id === room.spy) ? null : randomWord;
    });


    // --- NEW LOGIC FOR GENERATING DISCUSSION TURNS STRING ---
    const playerNames = room.players.map(p => p.name);
    const numPlayers = playerNames.length;

    for (let i = numPlayers - 1; i > 0; i--) {
    // Pick a random index from 0 to i
    const j = Math.floor(Math.random() * (i + 1));

    // Swap elements at i and j
    [playerNames[i], playerNames[j]] = [playerNames[j], playerNames[i]];
    
    }

    let turns = [];

    for (let i = 0; i < numPlayers; i++) {
        const asker = playerNames[i];
        const target = playerNames[(i + 1) % numPlayers]; // The next player in the list
        turns.push(`${asker} -> ${target}`);
    }

    // You can make this more complex if you want more turns or random order:
    // Example: double the turns, or shuffle after initial round-robin
    // For now, let's keep it simple as per your request.
    
    room.discussionTurnsString = turns.join(", "); // e.g., "King -> Speed, Speed -> Blaze, Blaze -> King"



    room.roundState = "playing";
    addChatMessage(roomCode, "Server", "New round started! Roles assigned.");
    addChatMessage(roomCode, "Server", `Suggested Discussion Flow: ${room.discussionTurnsString}`);
    room.lastUpdateTimestamp = Date.now();
}

function resetGame(roomCode) {
    const room = rooms[roomCode];
    if (room) {
        room.gameStarted = false;
        room.currentRound = 0;
        room.roundState = "waiting";
        room.word = "";
        room.spy = "";
        room.votes = {};
        room.chat = []; // Clear chat on game reset
        room.players.forEach(p => {
            p.score = 0;
            p.role = null;
            p.word = null;
            p.isHost = (room.players.indexOf(p) === 0); // Re-assign host if first in list
        });
        addChatMessage(roomCode, "Server", "Game has been reset.");
        room.lastUpdateTimestamp = Date.now();
    }
}

// Handle player disconnection (conceptual for HTTP - would need session management)
// For this polling model, a player "disconnects" if they stop polling or don't send their playerId for a long time.
// This is much harder to manage cleanly than with WebSockets.
// For now, players will just remain in the room until the server restarts or a dedicated "leave room" endpoint is called.
// To implement proper player removal: you'd need a "heartbeat" from the client and a server-side cleanup timer.

const PORT = 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`HTTP Server running on http://0.0.0.0:${PORT}`));