Github Pages is set up to render this to https://alexholcombe.github.io/CSF-visualize

Vibe-coded with agy.

Description for CVnet:

Many of you will be familiar with demonstrations that allow one to visualize one's own spatial or temporal contrast sensitivty function. For the spatial case, this is done by creating a continuous  gradient of low to high spatial frequencies (the horizontal axis), and smoothly varying the contrast from high to low (vertical axis). At each horizontal position, you scan to find the highest point at which you can still detect the grating, which indicates the sensitivity.

Thanks to LLMs, I was able to vibe-code a webpage for these demonstrations, a webpage (https://alexholcombe.github.io/CSF-visualize) that adjusts for your screen spatial and temporal resolution, and tries to avoid aliasing, although not always perfectly.

The URL updates dynamically when you change parameters so you can change the settings and then share the URL with others to achieve the same settings.

I'm using this for my teaching, and hope some of you may also find it useful.

##



Adjust gradient of spatial and temporal frequencies, for example to visualize one's own contrast sensitivity function (CSF) in space or time.



## Temporal contrast sensitivity function

[Settings](https://alexholcombe.github.io/CSF-visualize/?stripHeight=20&maxContrast=1&contrastScale=linear&minSpatialFreqCpd=0&deltaSpatialFreqCpd=0&spatialFreqScale=linear&viewingDistanceCm=57&gratingWidthCm=30&minTemporalFreq=1&deltaTemporalFreq=29&temporalFreqScale=linear&temporalStripWidth=92&temporalOccluderWidth=5&gamma=2.2) to visualise temporal contrast sensitivity function

When you have a temporal frequency delta, thereby asking for a range of temporal frequencies, it prevents you from doing the same with spatial and sets the spatial frequency to zero, a special mode.

## Anti-aliasing 

The code also measures your screen's refresh rate and constrains the maximum temporal frequency and the intermediate temporal frequencies to integer numbers of frames.

Some anti-aliasing avoidance is also implemented for spatial frequencies but it may not be perfect.




