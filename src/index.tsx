import { render } from 'preact';
import { useState, useRef, useEffect} from 'preact/hooks';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL, fetchFile } from '@ffmpeg/util';
import './style.css';

interface ProgressState {
  visible: boolean;
  percent: number;
  text: string;
}

interface VideoFile {
  file: File;
  duration: number;
  url: string;
}

interface ProcessedVideo {
  blob: Blob;
  url: string;
  originalName: string;
}

const App = () => {
  const [currentVideo, setCurrentVideo] = useState<VideoFile | null>(null);
  const [processedVideo, setProcessedVideo] = useState<ProcessedVideo | null>(null);
  const [progress, setProgress] = useState<ProgressState>({ visible: false, percent: 0, text: '' });
  const [error, setError] = useState<string>('');
  const [info, setInfo] = useState<string>('');
  const [isDragOver, setIsDragOver] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [ffmpegReady, setFfmpegReady] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const ffmpegRef = useRef<FFmpeg | null>(null);

  // Initialize FFmpeg
  useEffect(() => {
    const initializeFFmpeg = async () => {
      try {
        setProgress({ visible: true, percent: 0, text: 'Loading FFmpeg...' });
        
        const ffmpeg = new FFmpeg();
        
        // Set up progress handler
        ffmpeg.on('progress', ({ progress }) => {
          const progressPercent = Math.round(progress * 100);
          setProgress(prev => ({ 
            ...prev, 
            percent: 30 + progressPercent * 0.6, 
            text: `Processing video... ${progressPercent}%` 
          }));
        });

        // Load FFmpeg with CDN URLs for the core files
        const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
        await ffmpeg.load({
          coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
          wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
        });
        
        ffmpegRef.current = ffmpeg;
        setFfmpegReady(true);
        
        setProgress({ visible: false, percent: 0, text: '' });
        setInfo('FFmpeg loaded successfully! You can now upload a video.');
      } catch (error) {
        setProgress({ visible: false, percent: 0, text: '' });
        setError(`Failed to load FFmpeg: ${error}. Please refresh the page and try again.`);
      }
    };

    initializeFFmpeg();
  }, []);

  const clearMessages = () => {
    setError('');
    setInfo('');
  };

  const getVideoDuration = (file: File): Promise<number> => {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.onloadedmetadata = () => {
        resolve(video.duration);
        URL.revokeObjectURL(video.src);
      };
      video.onerror = reject;
      video.src = URL.createObjectURL(file);
    });
  };

  const getFileExtension = (filename: string): string => {
    return filename.split('.').pop()?.toLowerCase() || 'mp4';
  };

  const getMimeType = (filename: string): string => {
    const ext = getFileExtension(filename);
    const mimeTypes: { [key: string]: string } = {
      'mp4': 'video/mp4',
      'webm': 'video/webm',
      'avi': 'video/x-msvideo',
      'mov': 'video/quicktime',
      'mkv': 'video/x-matroska',
      'flv': 'video/x-flv',
      'wmv': 'video/x-ms-wmv'
    };
    return mimeTypes[ext] || 'video/mp4';
  };

  const handleFile = async (file: File) => {
    if (!ffmpegReady) {
      setError('FFmpeg is not loaded yet. Please wait for initialization to complete.');
      return;
    }

    clearMessages();
    setProcessedVideo(null);
    setIsProcessing(true);

    try {
      const duration = await getVideoDuration(file);
      
      if (duration <= 3) {
        throw new Error('Video is too short (3 seconds or less). Cannot trim 3 seconds.');
      }

      const videoFile: VideoFile = {
        file,
        duration,
        url: URL.createObjectURL(file)
      };

      setCurrentVideo(videoFile);
      await trimVideo(videoFile);
    } catch (error) {
      setError(`Error processing video: ${error}`);
      setIsProcessing(false);
    }
  };

  const trimVideo = async (videoFile: VideoFile) => {
    try {
      setProgress({ visible: true, percent: 10, text: 'Loading video file...' });
      console.log("Loading video file...");
      const { file, duration } = videoFile;
      const ffmpeg = ffmpegRef.current;
      
      if (!ffmpeg) {
        throw new Error('FFmpeg is not initialized');
      }

      setProgress({ visible: true, percent: 20, text: 'Preparing FFmpeg...' });

      console.log("Preparing ffmpeg");
      // Write input file to FFmpeg filesystem
      const inputFileName = `input.${getFileExtension(file.name)}`;
      const outputFileName = `output.${getFileExtension(file.name)}`;
      
      await ffmpeg.writeFile(inputFileName, await fetchFile(file));
      
      setProgress({ visible: true, percent: 30, text: 'Trimming video...' });
      
      console.log("Trimming video");
      // Calculate the end time (duration - 3 seconds)
      const endTime = duration - 3;
      
      // Run FFmpeg command to trim the video
      await ffmpeg.exec([
        '-i', inputFileName,
        '-t', endTime.toString(),
        '-c', 'copy',
        '-avoid_negative_ts', 'make_zero',
        outputFileName
      ]);
      
      setProgress({ visible: true, percent: 90, text: 'Finalizing...' });
      console.log("Finalizing...")
      // Read the output file
      const data = await ffmpeg.readFile(outputFileName);
      
      // Create blob from the processed video
      const mimeType = getMimeType(file.name);
      const blob = new Blob([data as Uint8Array], { type: mimeType });
      
      // Clean up FFmpeg filesystem
      await ffmpeg.deleteFile(inputFileName);
      await ffmpeg.deleteFile(outputFileName);
      
      setProcessedVideo({
        blob,
        url: URL.createObjectURL(blob),
        originalName: file.name
      });
      
      console.log(URL.createObjectURL(blob));
      setProgress({ visible: true, percent: 100, text: 'Complete!' });
      console.log("Complete!");
      setTimeout(() => setProgress({ visible: false, percent: 0, text: '' }), 1000);
      
    } catch (error) {
      setError(`Error processing video: ${error}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const downloadTrimmedVideo = () => {
    if (!processedVideo) return;
    
    const a = document.createElement('a');
    a.href = processedVideo.url;
    
    const originalExt = getFileExtension(processedVideo.originalName);
    const baseName = processedVideo.originalName.replace(/\.[^/.]+$/, '');
    a.download = `${baseName}_trimmed.${originalExt}`;
    
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleFileInput = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFile(file);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragOver(false);
    
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('video/')) {
      handleFile(file);
    }
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className="container">
      <div className="">
        <h1>Tiktok Trimmer</h1>
        <p style="text-align: center; color: #666; margin-bottom: 30px;">Perfectly trim the Tiktok outro from your downloaded videos. No more jumpscares!</p>
        
        <div 
          className="upload-area"
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={handleUploadClick}
        >
          <div className="upload-text">
            <strong>Drop your video here or click to browse</strong>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
            onChange={handleFileInput}
            className="hidden"
            style="color: #666"
          />
        </div>

        {currentVideo && (
          <div className="" >
            <video
              controls
              className=""
              src={currentVideo.url}
            />
            <div className="" style="color: #666; text-align: center;">
              <strong>Original Video:</strong> {currentVideo.file.name}<br />
              <strong>Size:</strong> {(currentVideo.file.size / (1024 * 1024)).toFixed(2)} MB<br />
              <strong>Type:</strong> {currentVideo.file.type}<br />
              <strong>Duration:</strong> {currentVideo.duration.toFixed(1)} seconds
            </div>
          </div>
        )}

        {progress.visible && (
          <div className="progress-container">
            <div className="progress-bar">
              <div 
                className="progress-fill"
                style={{ width: `${progress.percent}%` }}
              />
            </div>
            <div className="">{progress.text}</div>
          </div>
        )}

        {processedVideo && (
          <div className="">
            <div className="info-box" style="color: #666">
              <strong>✅ Processing complete!</strong> Your video has been trimmed successfully.
            </div>
            <div style="text-align: center;">
              <video
                controls
                src={processedVideo.url}
              />
              <div style="color: #666">
                <strong>Trimmed Video:</strong> Ready for download<br />
                <strong>Original Size:</strong> {(currentVideo?.file.size / (1024 * 1024)).toFixed(2)} MB<br />
                <strong>New Size:</strong> {(processedVideo.blob.size / (1024 * 1024)).toFixed(2)} MB<br />
                <strong>Format:</strong> {getFileExtension(processedVideo.originalName).toUpperCase()}<br />
              </div>
              <button
                onClick={downloadTrimmedVideo}
                className="btn download-btn"
              >
                Download Trimmed Video
              </button>
            </div>
          </div>
        )}

        {error && (
          <div className="error-container" style="color: #666">
            <strong>❌ Error:</strong> {error}
          </div>
        )}

        {info && (
          <div className="error-container" style="color: #666">
            <strong style="color: #666">ℹ️ Info:</strong> {info}
          </div>
        )}
      </div>
    </div>
  );
};

render(<App />, document.getElementById('app'));
