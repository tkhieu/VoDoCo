/**
 * VietMed-NER Presentation Demo JavaScript
 * Interactive functionality for audio demos and NER visualization
 */

// ========================================
// Global Variables
// ========================================

let selectedAudioFile = null;
let mediaRecorder = null;
let recordedChunks = [];
let recordingTimer = null;
let recordingStartTime = null;

// ========================================
// Sample Data for Demo
// ========================================

const sampleASROutput = {
    text: "bệnh nhân bị đau đầu và sốt cao đã ba ngày",
    confidence: 0.92,
    duration: 3.5,
    model: "Whisper-Small-Vietnamese"
};

const sampleNERResults = {
    text: "bệnh nhân bị đau đầu và sốt cao đã ba ngày",
    entities: [
        {
            text: "đau đầu",
            type: "SYMPTOM",
            start: 16,
            end: 23,
            confidence: 0.94
        },
        {
            text: "sốt cao",
            type: "SYMPTOM",
            start: 27,
            end: 34,
            confidence: 0.91
        },
        {
            text: "ba ngày",
            type: "DURATION",
            start: 39,
            end: 46,
            confidence: 0.88
        }
    ]
};

const entityColors = {
    'SYMPTOM': '#E74C3C',
    'DISEASE': '#E67E22',
    'DRUG': '#9B59B6',
    'TEST': '#3498DB',
    'ANATOMY': '#1ABC9C',
    'DURATION': '#F39C12',
    'OTHER': '#95A5A6'
};

// ========================================
// Pre-recorded Audio Demo Functions
// ========================================

/**
 * Handle file selection for pre-recorded audio demo
 */
function selectAudioFile() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'audio/*';
    
    input.onchange = (event) => {
        const file = event.target.files[0];
        if (file) {
            selectedAudioFile = file;
            displayAudioPlayer(file);
            document.getElementById('analyzeBtn').disabled = false;
        }
    };
    
    input.click();
}

/**
 * Display audio player for selected file
 */
function displayAudioPlayer(file) {
    const audioPlayer = document.getElementById('audioPlayer');
    const audioElement = document.getElementById('audioElement');
    
    const url = URL.createObjectURL(file);
    audioElement.src = url;
    audioPlayer.style.display = 'block';
}

/**
 * Analyze audio file and show results
 */
function analyzeAudio() {
    if (!selectedAudioFile) {
        alert('Vui lòng chọn file audio trước');
        return;
    }
    
    // Show progress
    const progress = document.getElementById('progress');
    progress.style.display = 'block';
    
    // Hide previous results
    document.getElementById('asrOutput').style.display = 'none';
    document.getElementById('nerOutput').style.display = 'none';
    
    // Simulate ASR processing (2-3 seconds)
    setTimeout(() => {
        showASROutput();
        
        // Simulate NER processing (1-2 seconds)
        setTimeout(() => {
            showNEROutput();
            progress.style.display = 'none';
        }, 1500);
    }, 2500);
}

/**
 * Display ASR output
 */
function showASROutput() {
    const asrOutput = document.getElementById('asrOutput');
    const asrText = document.getElementById('asrText');
    
    asrText.innerHTML = `
        <strong>Model:</strong> ${sampleASROutput.model}<br>
        <strong>Confidence:</strong> ${(sampleASROutput.confidence * 100).toFixed(1)}%<br>
        <strong>Duration:</strong> ${sampleASROutput.duration}s<br><br>
        <strong>Text:</strong> "${sampleASROutput.text}"
    `;
    
    asrOutput.style.display = 'block';
}

/**
 * Display NER output with highlighted entities
 */
function showNEROutput() {
    const nerOutput = document.getElementById('nerOutput');
    const nerText = document.getElementById('nerText');
    const entityTableBody = document.getElementById('entityTableBody');
    
    // Highlight entities in text
    let highlightedText = sampleNERResults.text;
    const sortedEntities = [...sampleNERResults.entities].sort((a, b) => b.start - a.start);
    
    sortedEntities.forEach(entity => {
        const before = highlightedText.substring(0, entity.start);
        const entitySpan = `<span class="entity-highlight" style="background: ${entityColors[entity.type]}22; color: ${entityColors[entity.type]}; border-bottom: 2px solid ${entityColors[entity.type]}; padding: 2px 4px; border-radius: 3px; font-weight: 600;">${entity.text}</span>`;
        const after = highlightedText.substring(entity.end);
        highlightedText = before + entitySpan + after;
    });
    
    nerText.innerHTML = highlightedText;
    
    // Populate entity table
    entityTableBody.innerHTML = '';
    sampleNERResults.entities.forEach(entity => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td><strong>${entity.text}</strong></td>
            <td><span class="tag tag-${entity.type.toLowerCase()}" style="background: ${entityColors[entity.type]};">${entity.type}</span></td>
            <td>${entity.start}-${entity.end}</td>
            <td>${(entity.confidence * 100).toFixed(1)}%</td>
        `;
        entityTableBody.appendChild(row);
    });
    
    nerOutput.style.display = 'block';
}

// ========================================
// Live Recording Demo Functions
// ========================================

/**
 * Start recording from microphone
 */
async function startRecording() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        
        // Initialize MediaRecorder
        mediaRecorder = new MediaRecorder(stream);
        recordedChunks = [];
        
        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                recordedChunks.push(event.data);
            }
        };
        
        mediaRecorder.onstop = handleRecordingStop;
        
        // Start recording
        mediaRecorder.start();
        recordingStartTime = Date.now();
        
        // Update UI
        document.getElementById('recordBtn').disabled = true;
        document.getElementById('stopBtn').disabled = false;
        document.getElementById('clearBtn').disabled = true;
        document.getElementById('statusText').textContent = 'Đang thu âm...';
        document.getElementById('statusText').style.color = '#E74C3C';
        document.getElementById('timer').style.display = 'inline';
        document.getElementById('waveform').style.display = 'block';
        
        // Start timer
        startTimer();
        
    } catch (error) {
        console.error('Error accessing microphone:', error);
        alert('Không thể truy cập microphone. Vui lòng kiểm tra quyền truy cập.');
    }
}

/**
 * Stop recording
 */
function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
        mediaRecorder.stream.getTracks().forEach(track => track.stop());
        
        // Update UI
        document.getElementById('recordBtn').disabled = false;
        document.getElementById('stopBtn').disabled = true;
        document.getElementById('clearBtn').disabled = false;
        document.getElementById('statusText').textContent = 'Đang xử lý...';
        document.getElementById('statusText').style.color = '#3498DB';
        document.getElementById('waveform').style.display = 'none';
        
        // Stop timer
        stopTimer();
    }
}

/**
 * Clear recording and reset UI
 */
function clearRecording() {
    recordedChunks = [];
    recordingStartTime = null;
    
    // Reset UI
    document.getElementById('recordBtn').disabled = false;
    document.getElementById('stopBtn').disabled = true;
    document.getElementById('clearBtn').disabled = true;
    document.getElementById('statusText').textContent = '';
    document.getElementById('timer').textContent = '00:00';
    document.getElementById('timer').style.display = 'none';
    document.getElementById('recordingPlayer').style.display = 'none';
    document.getElementById('recordingOutput').style.display = 'none';
}

/**
 * Handle recording stop event
 */
function handleRecordingStop() {
    // Create audio blob
    const blob = new Blob(recordedChunks, { type: 'audio/webm' });
    const url = URL.createObjectURL(blob);
    
    // Display audio player
    const recordedAudio = document.getElementById('recordedAudio');
    recordedAudio.src = url;
    document.getElementById('recordingPlayer').style.display = 'block';
    
    // Simulate processing and show results
    setTimeout(() => {
        processRecordedAudio();
    }, 2000);
}

/**
 * Process recorded audio and show NER results
 */
function processRecordedAudio() {
    const recordingText = document.getElementById('recordingText');
    document.getElementById('statusText').textContent = 'Hoàn thành';
    document.getElementById('statusText').style.color = '#27AE60';
    
    // Use sample data for demo
    let highlightedText = sampleNERResults.text;
    const sortedEntities = [...sampleNERResults.entities].sort((a, b) => b.start - a.start);
    
    sortedEntities.forEach(entity => {
        const before = highlightedText.substring(0, entity.start);
        const entitySpan = `<span class="entity-highlight" style="background: ${entityColors[entity.type]}22; color: ${entityColors[entity.type]}; border-bottom: 2px solid ${entityColors[entity.type]}; padding: 2px 4px; border-radius: 3px; font-weight: 600;">${entity.text}</span>`;
        const after = highlightedText.substring(entity.end);
        highlightedText = before + entitySpan + after;
    });
    
    recordingText.innerHTML = `
        <strong>ASR Output:</strong><br>
        ${highlightedText}<br><br>
        <strong>Detected Entities:</strong><br>
        ${sampleNERResults.entities.map(e => `<span class="tag" style="background: ${entityColors[e.type]}; color: white; padding: 4px 8px; border-radius: 12px; margin: 4px; display: inline-block; font-size: 0.9em;">${e.type}: ${e.text}</span>`).join('')}
    `;
    
    document.getElementById('recordingOutput').style.display = 'block';
}

/**
 * Start recording timer
 */
function startTimer() {
    recordingTimer = setInterval(() => {
        const elapsed = Date.now() - recordingStartTime;
        const seconds = Math.floor(elapsed / 1000);
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        
        const display = `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
        document.getElementById('timer').textContent = display;
    }, 1000);
}

/**
 * Stop recording timer
 */
function stopTimer() {
    if (recordingTimer) {
        clearInterval(recordingTimer);
        recordingTimer = null;
    }
}

// ========================================
// Utility Functions
// ========================================

/**
 * Load sample data from JSON file (if available)
 */
async function loadSampleData() {
    try {
        const response = await fetch('assets/data/sample-results.json');
        if (response.ok) {
            const data = await response.json();
            // Update sample data with loaded data
            console.log('Sample data loaded:', data);
        }
    } catch (error) {
        console.log('Using default sample data');
    }
}

/**
 * Initialize demo when page loads
 */
document.addEventListener('DOMContentLoaded', () => {
    console.log('VietMed-NER Presentation Demo initialized');
    loadSampleData();
});

// ========================================
// Export functions for global access
// ========================================

window.selectAudioFile = selectAudioFile;
window.analyzeAudio = analyzeAudio;
window.startRecording = startRecording;
window.stopRecording = stopRecording;
window.clearRecording = clearRecording;
