import React, { useEffect, useRef } from 'react';
import { VisualizerMode } from '../types';

interface OrbProps {
  mode: VisualizerMode;
  volume: number; // 0 to 1
}

const Orb: React.FC<OrbProps> = ({ mode, volume }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationId: number;
    let time = 0;

    const render = () => {
      time += 0.05;
      
      // Auto-resize
      canvas.width = canvas.clientWidth * window.devicePixelRatio;
      canvas.height = canvas.clientHeight * window.devicePixelRatio;
      const w = canvas.width;
      const h = canvas.height;
      const centerX = w / 2;
      const centerY = h / 2;
      
      ctx.clearRect(0, 0, w, h);
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

      // Base radius
      const baseRadius = 60;
      // React to volume
      const pulse = volume * 100; 

      let color1 = '#0ea5e9'; // Blue default
      let color2 = '#8b5cf6'; // Purple

      if (mode === VisualizerMode.SPEAKING) {
        color1 = '#10b981'; // Green
        color2 = '#34d399';
      } else if (mode === VisualizerMode.LISTENING) {
         color1 = '#f43f5e'; // Pink/Red when user talks (listening active)
         color2 = '#f472b6';
      }

      // Draw Orb
      const gradient = ctx.createRadialGradient(centerX / window.devicePixelRatio, centerY / window.devicePixelRatio, 0, centerX / window.devicePixelRatio, centerY / window.devicePixelRatio, baseRadius + pulse);
      gradient.addColorStop(0, color1);
      gradient.addColorStop(0.5, color2);
      gradient.addColorStop(1, 'rgba(0,0,0,0)');

      ctx.fillStyle = gradient;
      ctx.beginPath();
      
      // Wobbly shape
      const spikes = 12;
      for(let i=0; i < spikes; i++) {
          const angle = (i / spikes) * Math.PI * 2 + time;
          const r = (baseRadius + pulse) + Math.sin(angle * 3) * 5;
          const x = (centerX / window.devicePixelRatio) + Math.cos(angle) * r;
          const y = (centerY / window.devicePixelRatio) + Math.sin(angle) * r;
          if (i===0) ctx.moveTo(x,y);
          else ctx.lineTo(x,y);
      }
      ctx.closePath();
      ctx.fill();

      // Outer glow ring
      ctx.strokeStyle = color1;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(centerX / window.devicePixelRatio, centerY / window.devicePixelRatio, baseRadius + pulse + 10, 0, Math.PI * 2);
      ctx.stroke();

      animationId = requestAnimationFrame(render);
    };

    render();

    return () => cancelAnimationFrame(animationId);
  }, [mode, volume]);

  return (
    <canvas 
      ref={canvasRef} 
      className="w-48 h-48 rounded-full filter blur-[1px]"
    />
  );
};

export default Orb;
