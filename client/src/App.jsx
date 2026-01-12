import { useState, useEffect, useRef, useCallback } from "react";
import { v4 as uuidv4 } from 'uuid';

// Determine the API server URL
const getApiBaseUrl = () => {
  if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
    return "http://localhost:3000/api";
  } else {
    const currentHost = window.location.hostname;
    const serverPort = 3000;
    const serverHost = currentHost.replace(/-\d+\.app\.github\.dev/, `-${serverPort}.app.github.dev`);
    return `https://${serverHost}/api`;
  }
};

const API_BASE_URL = getApiBaseUrl();
console.log("Connecting to API server at:", API_BASE_URL);

// Polling interval (how often the client asks the server for updates)
const POLLING_INTERVAL_MS = 1500;

// --- NEW: Color Palette ---
const colors = {
  primary: '#1a1a2e',      // Dark background
  secondary: '#16213e',    // Slightly lighter dark for cards/sections
  accent: '#e94560',       // Main accent color (buttons, highlights)
  textLight: '#e0e0e0',    // Light text on dark background
  textDim: '#a0a0a0',      // Dimmer text for secondary info
  border: '#0f3460',       // Border color
  success: '#6a9955',      // Green for success/wins
  error: '#cc0000',        // Red for errors/spy caught
  warning: '#f4a261',      // Orange for warnings/host
  spyBackground: '#4a154b', // Distinct background for spy's info
};


export default function App() {
  const [name, setName] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [inRoom, setInRoom] = useState(false);
  const [myPlayerId, setMyPlayerId] = useState(() => localStorage.getItem('myPlayerId') || uuidv4());
  const [myRole, setMyRole] = useState(null);
  const [myWord, setMyWord] = useState(null);
  const [chat, setChat] = useState([]);
  const [msg, setMsg] = useState("");

  const [players, setPlayers] = useState([]);
  const [gameStarted, setGameStarted] = useState(false);
  const [currentRound, setCurrentRound] = useState(0);
  const [roundState, setRoundState] = useState("waiting");
  const [lastRoundResult, setLastRoundResult] = useState("");
  const [selectedVoteTarget, setSelectedVoteTarget] = useState("");
  const [discussionTurnsString, setDiscussionTurnsString] = useState(""); // Holds the string

  const chatRef = useRef(null);

  // Persist myPlayerId across refreshes
  useEffect(() => {
    localStorage.setItem('myPlayerId', myPlayerId);
  }, [myPlayerId]);

  // Scroll chat to bottom
  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, [chat]);

  // --- API Calls (unchanged from previous version) ---
  const fetchGameState = useCallback(async () => {
    if (!inRoom || !roomCode || !myPlayerId) return;

    try {
      const response = await fetch(`${API_BASE_URL}/room/${roomCode}/state/${myPlayerId}`);
      if (!response.ok) {
        const errorData = await response.json();
        console.error("Error fetching game state:", errorData.error);
        if (response.status === 401) {
            alert("Your player session has expired or you've been removed. Please rejoin.");
            setInRoom(false);
            setMyPlayerId(uuidv4());
            localStorage.removeItem('myPlayerId');
        }
        return;
      }
      const state = await response.json();

      setPlayers(state.players);
      setGameStarted(state.gameStarted);
      setCurrentRound(state.currentRound);
      setRoundState(state.roundState);
      setMyRole(state.myRole);
      setMyWord(state.myWord);
      setChat(state.chat);
      setDiscussionTurnsString(state.discussionTurnsString);

    } catch (error) {
      console.error("Failed to fetch game state:", error);
    }
  }, [inRoom, roomCode, myPlayerId]);

  // Polling Effect
  useEffect(() => {
    if (inRoom && roomCode && myPlayerId) {
      const interval = setInterval(fetchGameState, POLLING_INTERVAL_MS);
      return () => clearInterval(interval);
    }
  }, [inRoom, roomCode, myPlayerId, fetchGameState]);


  const joinRoom = async () => {
    if (!name || !roomCode) {
        alert("Please enter both your name and a room code.");
        return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/join-room`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, room: roomCode, playerId: myPlayerId }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        alert(`Error joining room: ${errorData.error}`);
        return;
      }

      const data = await response.json();
      setMyPlayerId(data.playerId);
      setInRoom(true);
      setPlayers(data.roomState.players);
      setGameStarted(data.roomState.gameStarted);
      setCurrentRound(data.roomState.currentRound);
      setRoundState(data.roomState.roundState);
      setMyRole(data.roomState.myRole);
      setMyWord(data.roomState.myWord);
      setChat(data.roomState.chat);
      setDiscussionTurnsString(data.roomState.discussionTurnsString); // Set initial
      fetchGameState();

    } catch (error) {
      console.error("Failed to join room:", error);
      alert("Failed to join room. Please try again.");
    }
  };

  const startGame = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/room/${roomCode}/start-game`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId: myPlayerId }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        alert(`Error starting game: ${errorData.error}`);
      } else {
        fetchGameState();
      }
    } catch (error) {
      console.error("Failed to start game:", error);
      alert("Failed to start game. Please try again.");
    }
  };

  const startVote = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/room/${roomCode}/start-vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId: myPlayerId }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        alert(`Error starting vote: ${errorData.error}`);
      } else {
        fetchGameState();
      }
    } catch (error) {
      console.error("Failed to start vote:", error);
      alert("Failed to start vote. Please try again.");
    }
  };

  const castVote = async () => {
    if (!selectedVoteTarget) {
      alert("Please select a player to vote for.");
      return;
    }
    try {
      const response = await fetch(`${API_BASE_URL}/room/${roomCode}/cast-vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voterId: myPlayerId, targetPlayerId: selectedVoteTarget }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        alert(`Error casting vote: ${errorData.error}`);
      } else {
        setSelectedVoteTarget("");
        fetchGameState();
      }
    } catch (error) {
      console.error("Failed to cast vote:", error);
      alert("Failed to cast vote. Please try again.");
    }
  };

  const endRound = async () => {
    try {
        const response = await fetch(`${API_BASE_URL}/room/${roomCode}/end-round`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ playerId: myPlayerId }),
        });

        if (!response.ok) {
            const errorData = await response.json();
            alert(`Error ending round: ${errorData.error}`);
        } else {
            fetchGameState();
        }
    } catch (error) {
        console.error("Failed to end round:", error);
        alert("Failed to end round. Please try again.");
    }
  };


  const sendMessage = async () => {
    if (!msg.trim()) return;

    try {
      const response = await fetch(`${API_BASE_URL}/room/${roomCode}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, msg }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        alert(`Error sending message: ${errorData.error}`);
      } else {
        setMsg("");
        fetchGameState();
      }
    } catch (error) {
      console.error("Failed to send message:", error);
      alert("Failed to send message. Please try again.");
    }
  };

  const myPlayer = players.find(p => p.id === myPlayerId);
  const isHost = myPlayer?.isHost;
  const canStartGame = isHost && players.length >= 2 && !gameStarted;
  const canStartVote = isHost && gameStarted && roundState === "playing";
  const canCastVote = gameStarted && roundState === "voting" && myPlayerId && selectedVoteTarget;
  const canEndRound = isHost && gameStarted && roundState === "voting";

  // --- UI RENDERING ---
  return (
    <div style={{
      minHeight: '100vh',
    width: '100vw',
    backgroundColor: colors.primary,
    color: colors.textLight,
    fontFamily: "Arial, sans-serif",
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    padding: '20px',
    boxSizing: 'border-box',
    }}>
      {/* Join Room UI */}
      {!inRoom && (
        <div style={{
            backgroundColor: colors.secondary,
        padding: '30px',
        borderRadius: '15px',
        boxShadow: `0 8px 16px ${colors.border}`,
        width: '100%',
        maxWidth: '700px',
        textAlign: 'center',
        }}>
          <h2 style={{ color: colors.accent, marginBottom: '30px' }}>🎭 برا السالفة</h2>
          <input
            style={{
              padding: '12px',
              margin: '10px 0',
              width: 'calc(100% - 24px)',
              borderRadius: '8px',
              border: `1px solid ${colors.border}`,
              backgroundColor: colors.primary,
              color: colors.textLight,
              fontSize: '1em'
            }}
            placeholder="اسمك"
            value={name}
            onChange={(e) => setName(e.target.value)}
          /><br/><br/>
          <input
            style={{
              padding: '12px',
              margin: '10px 0',
              width: 'calc(100% - 24px)',
              borderRadius: '8px',
              border: `1px solid ${colors.border}`,
              backgroundColor: colors.primary,
              color: colors.textLight,
              fontSize: '1em'
            }}
            placeholder="رمز الغرفة"
            value={roomCode}
            onChange={(e) => setRoomCode(e.target.value)}
          /><br/><br/>
          <button
            onClick={joinRoom}
            style={{
              padding: '12px 25px',
              backgroundColor: colors.accent,
              color: colors.textLight,
              border: 'none',
              borderRadius: '8px',
              fontSize: '1.1em',
              fontWeight: 'bold',
              cursor: 'pointer',
              marginTop: '20px',
              transition: 'background-color 0.2s'
            }}
            onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#d23d53'}
            onMouseOut={(e) => e.currentTarget.style.backgroundColor = colors.accent}
          >
            دخول
          </button>
        </div>
      )}

      {/* Game Room UI */}
      {inRoom && (
        <div style={{
        backgroundColor: colors.secondary,
        padding: '30px',
        borderRadius: '15px',
        boxShadow: `0 8px 16px ${colors.border}`,
        width: '100%',
        maxWidth: '700px',
        textAlign: 'center',
        }}>
          <h3 style={{ color: colors.textLight, marginBottom: '20px' }}>
            Room: <span style={{ color: colors.accent }}>{roomCode}</span> {gameStarted && `(Round ${currentRound})`}
          </h3>

          <h4 style={{ color: colors.textDim, marginBottom: '15px' }}>Players ({players.length}):</h4>
          <div style={{
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'center',
            gap: '12px', // Slightly larger gap
            marginBottom: '25px'
          }}>
            {players.map((p) => (
              <div
                key={p.id}
                style={{
                  border: `2px solid ${p.id === myPlayerId ? colors.accent : colors.border}`,
                  padding: '8px 15px',
                  borderRadius: '10px',
                  backgroundColor: p.isHost ? colors.warning : colors.primary, // Host has warning color
                  color: p.isHost ? colors.primary : colors.textLight, // Text color for host
                  fontWeight: 'bold',
                  boxShadow: `0 2px 5px rgba(0,0,0,0.3)`
                }}
              >
                {p.name} {p.isHost && "(مضيف)"} {p.score !== undefined && `(${p.score})`}
              </div>
            ))}
          </div>

          <br/>

          {!gameStarted && canStartGame && (
            <button
              onClick={startGame}
              style={{
                padding: '12px 25px',
                backgroundColor: colors.success, // Green for starting
                color: colors.primary, // Dark text on green
                border: 'none',
                borderRadius: '8px',
                fontSize: '1.1em',
                fontWeight: 'bold',
                cursor: 'pointer',
                marginBottom: '20px',
                transition: 'background-color 0.2s'
              }}
              onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#5ca042'}
              onMouseOut={(e) => e.currentTarget.style.backgroundColor = colors.success}
            >
              ابدأ اللعبة
            </button>
          )}

          {gameStarted && (
              <div style={{ marginBottom: '20px' }}>
                  {myRole === "spy" ? (
                      <h3 style={{ color: colors.error, backgroundColor: colors.spyBackground, padding: '10px', borderRadius: '8px' }}>
                        <span style={{ fontSize: '1.5em', marginRight: '10px' }}>❓</span> أنت الجاسوس!
                      </h3>
                  ) : (
                      <h3 style={{ color: colors.textLight }}>
                        <span style={{ fontSize: '1.5em', marginRight: '10px' }}>🗝</span> الكلمة: <span style={{ color: colors.accent }}>{myWord}</span>
                      </h3>
                  )}
                  {lastRoundResult && <p style={{ color: colors.success, fontWeight: 'bold', marginTop: '15px' }}>{lastRoundResult}</p>}

                  {roundState === "playing" && (
                    <div style={{ marginTop: '20px', marginBottom: '20px' }}>
                        <h4 style={{ color: colors.textDim }}>جولة النقاش:</h4>
                        {discussionTurnsString ? (
                            <p style={{ fontWeight: 'bold', fontSize: '1.1em', color: colors.textLight, backgroundColor: colors.primary, padding: '15px', borderRadius: '10px', boxShadow: `0 2px 8px ${colors.border}` }}>
                                {discussionTurnsString}
                            </p>
                        ) : (
                            <p style={{ color: colors.textDim }}>النقاش جاري...</p>
                        )}
                    </div>
                  )}
                  {roundState === "voting" && <p style={{ color: colors.error, fontWeight: 'bold' }}>التصويت جاري!</p>}
                  {roundState === "ended" && <p style={{ color: colors.textDim }}>الجولة انتهت، انتظر الجولة التالية.</p>}
                  {roundState === "waiting" && gameStarted && <p style={{ color: colors.textDim }}>انتظار بدء الجولة الأولى.</p>}


                  <div style={{ display: 'flex', justifyContent: 'center', gap: '15px', marginTop: '20px' }}>
                    {canStartVote && (
                      <button
                        onClick={startVote}
                        style={{
                          padding: '12px 25px',
                          backgroundColor: colors.accent,
                          color: colors.textLight,
                          border: 'none',
                          borderRadius: '8px',
                          fontSize: '1em',
                          fontWeight: 'bold',
                          cursor: 'pointer',
                          transition: 'background-color 0.2s'
                        }}
                        onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#d23d53'}
                        onMouseOut={(e) => e.currentTarget.style.backgroundColor = colors.accent}
                      >
                        ابدأ التصويت الآن
                      </button>
                    )}
                    {canEndRound && (
                      <button
                        onClick={endRound}
                        style={{
                          padding: '12px 25px',
                          backgroundColor: colors.error, // Red for ending round
                          color: colors.textLight,
                          border: 'none',
                          borderRadius: '8px',
                          fontSize: '1em',
                          fontWeight: 'bold',
                          cursor: 'pointer',
                          transition: 'background-color 0.2s'
                        }}
                        onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#a00000'}
                        onMouseOut={(e) => e.currentTarget.style.backgroundColor = colors.error}
                      >
                        انهاء الجولة (المضيف)
                      </button>
                    )}
                  </div>


                  {roundState === "voting" && (
                      <div style={{ marginTop: '30px', marginBottom: '20px', padding: '15px', backgroundColor: colors.primary, borderRadius: '10px' }}>
                          <select
                              value={selectedVoteTarget}
                              onChange={(e) => setSelectedVoteTarget(e.target.value)}
                              style={{
                                  padding: '10px',
                                  marginRight: '15px',
                                  borderRadius: '8px',
                                  border: `1px solid ${colors.border}`,
                                  backgroundColor: colors.secondary,
                                  color: colors.textLight,
                                  fontSize: '1em'
                              }}
                          >
                              <option value="" style={{ backgroundColor: colors.secondary, color: colors.textLight }}>صوت لمن تظنه الجاسوس</option>
                              {players.filter(p => p.id !== myPlayerId).map(p => (
                                  <option key={p.id} value={p.id} style={{ backgroundColor: colors.secondary, color: colors.textLight }}>{p.name}</option>
                              ))}
                          </select>
                          <button
                            onClick={castVote}
                            disabled={!selectedVoteTarget || !canCastVote}
                            style={{
                              padding: '10px 20px',
                              backgroundColor: colors.accent,
                              color: colors.textLight,
                              border: 'none',
                              borderRadius: '8px',
                              fontSize: '1em',
                              fontWeight: 'bold',
                              cursor: 'pointer',
                              transition: 'background-color 0.2s',
                              opacity: (!selectedVoteTarget || !canCastVote) ? 0.6 : 1
                            }}
                            onMouseOver={(e) => (!selectedVoteTarget || !canCastVote) ? null : e.currentTarget.style.backgroundColor = '#d23d53'}
                            onMouseOut={(e) => (!selectedVoteTarget || !canCastVote) ? null : e.currentTarget.style.backgroundColor = colors.accent}
                          >
                            إرسال التصويت
                          </button>
                      </div>
                  )}
              </div>
          )}


          <hr style={{ width: "80%", border: `1px solid ${colors.border}`, margin: "30px auto" }}/>

          <div
            ref={chatRef}
            style={{
              height: "200px",
              overflowY: "auto",
              border: `1px solid ${colors.border}`,
              margin: "20px auto",
              width: "calc(100% - 20px)", // Adjusted for padding
              padding: "10px",
              textAlign: "left",
              backgroundColor: colors.primary,
              borderRadius: '10px',
              boxShadow: `inset 0 2px 5px rgba(0,0,0,0.5)`
            }}
          >
            {chat.map((c, i) => (
              <div key={i} style={{ marginBottom: '5px' }}>
                <b style={{ color: colors.accent }}>{c.name}:</b> {c.msg}
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '10px' }}>
            <input
              placeholder="اكتب رسالة"
              value={msg}
              onChange={(e) => setMsg(e.target.value)}
              onKeyPress={(e) => { if (e.key === "Enter") sendMessage(); }}
              style={{
                width: "calc(100% - 120px)", // Adjust width for button and gap
                padding: "10px",
                borderRadius: '8px',
                border: `1px solid ${colors.border}`,
                backgroundColor: colors.primary,
                color: colors.textLight,
                fontSize: '1em'
              }}
            />
            <button
              onClick={sendMessage}
              style={{
                padding: "10px 20px",
                backgroundColor: colors.accent,
                color: colors.textLight,
                border: 'none',
                borderRadius: '8px',
                fontSize: '1em',
                fontWeight: 'bold',
                cursor: 'pointer',
                transition: 'background-color 0.2s'
              }}
              onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#d23d53'}
              onMouseOut={(e) => e.currentTarget.style.backgroundColor = colors.accent}
            >
              إرسال
            </button>
          </div>
        </div>
      )}
    </div>
  );
}