————————Grating spatial and temporal frequency alex plan————

Sinusoidal luminance-defined horizontal grating. But draw it in horizontal strips (of stripHeight pixels thick, set by user in a slider that goes from 1 to 40), where the maximum contrast (set by user in a Max contrast slider that goes from 0 to 1) is the contrast of the bottom strip, and successive strips have lower contrast (of contrastStep amount less, set by user in a stepContrast slider that goes from .005 to .1)
The strip with the minimum contrast is at the top of the display. The strips should be contiguous rather than separated. The number of strips is set by the height of the visible webpage.

The sliders are in a vertical margin to the left of the grating strips.
The grating mid-grey should be RGB of 186,186,186. The maximum and minimum, given the contrast of that strip, should be calculated based on the gamma given in another slider, that slides from 1 to 2.6, default value 2.2. Assume minimum luminance is 5 cd/m^2 and maximum 190 cd/m^2.

The temporal frequency of the grating should be set by a slider, whose default value is 0, slider goes from 0 cycles per second to 100 cycles per second.

=== revision ====

Change the contrast step to be automatically calculated based on the srip height and max contrast. Change the default max contrast to 1. Along the right side, create a blank grey strip and add a text label in white for the contrast at that height, include as many labels as will fit when separated by one line.

Remove the Mid-grey readout and modulation readout.

Add a slider for the minimum spatial frequency, which will be used leftmost in each strip, and a slider for maximum spatial frequency, which is to be used for the rightmost in each strip . Delete the existing spatial frequency slider.  Have the spatial frequency gradually spatially change from left to right from the minimum to the maximum.
Add a slider for viewing distance , 20 to 80 cm, and one for width of webpage grating area in cm, 5 to 60cm. Use those values to calculate the spatial frequencies, which should be labelled in text along the bottom of the webpage.

Add a slider for the minimum temporal frequency, which will be used leftmost in each strip, and a slider for maximum temporal frequency, which is to be used for the rightmost in each strip . Delete the existing temporal frequency slider.  Have the temporal frequency gradually spatially change from left to right from the minimum to the maximum.

== revision 2 ==

Change the gamma slider label to RGB->luminance exponent (gamma)
Add a drop-down that changes the contrast gradient from linear spacing to logarithmic, default linear.
Always include a 0.00 contrast label where the contrast becomes exactly zero. For every contrast label, include a several pixel long black line, extending toward the gratings from the text.

Add a drop-down that changes the frequency gradient from linear spacing to logarithmic, default linear.

Replace max spatial frequency and max temporal frequency slider to max - min, so setting it to zero always makes the maximum the same as the minimum.

== Revision 3 ==

REduce minimum spatial frequency of slider to .03, and change default to .06.
Change spatial frequency range to 2.0cpd.

Add a drop-down for spatial frequency spacing , linear or logarithmic, and also one for temporal frequency spacing.
