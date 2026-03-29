"use strict";
const Ant  = require('ant-plus');

var FitnessEquipment = function() {
  var stick = new Ant.GarminStick3;
  if (!stick.is_present()) {
    stick = new Ant.GarminStick2;
    if (!stick.is_present()) {
      //console.log('No ANT+ device found!');
    } else {
      //console.log('ANT+ device type GarminStick2 found');  
    }
  } else  {
    //console.log('ANT+ device type GarminStick3 found');
  }

  stick.on('startup', function () {
    //console.log('Max channels:', stick.maxChannels);  
    stick.write(Ant.Messages.assignChannel(0x01, 'transmit')); //channel, ChannelType (transmit == 0x10 == CHANNEL_TYPE_TWOWAY_TRANSMIT)
    // The device type shall be set to 11 (0x0B) when searching to pair to an ANT+ bike power sensor
    // The transmitting sensor contains a 16-bit number that uniquely identifies its
    // transmissions. Set the Device Number parameter to zero to allow wildcard
    // matching. Once the device number is learned, the receiving device should
    // remember the number for future searches.
    // Device number set to 1 here    
    stick.write(Ant.Messages.setDevice(0x01, 0x3256, 0x11, 0x05)); //channel, deviceID,  deviceType, transmissionType
    // RF Channel 57 (2457 MHz) is used for the ANT+ bike power sensor.
    stick.write(Ant.Messages.setFrequency(0x01, 0x39)); //channel 57
    // Channel period Data is transmitted from most bike power sensors every 8182/32768 seconds
    // (approximately 4.00 Hz). This channel period shall be used by default.
    stick.write(Ant.Messages.setPeriod(0x01, 8192));
    stick.write(Ant.Messages.openChannel(0x01));    
    //console.log('FE-C initialized');
  });

  stick.on('shutdown', function () {
    //console.log('ANT+ shutdown');
  });

  if (!stick.open()) {
    //console.log('ANT+ USB stick not found!');
  }
  
  this.stick = stick;
  this.iEventCount=0;
  this.power_accumulated=0;
};

/*
Combine to nibbles to one Byte
*/
FitnessEquipment.prototype.nibble2Byte = function(LSN,MSN){
  return(((MSN & 0xF)<<4)|(LSN & 0xF));
}

/*
time        elapsed Time in s
distance    distance traveld in m
speed       speed in m/s
heartRate   heart rate in beats per minute
feState     state of the FC sleeping (1), ready (2), used (3), pause (4)
*/
FitnessEquipment.prototype.Page_0X10 = function(clock, distance, speed, feState) {
  //console.log('Page_0X10(clock=%d s, distance=%d m, speed=%d m/s, cadence=%d rpm, feState=%d)',clock,distance,speed,cadence,feState);
  var data = [];    
  /*
    low nibble is Capabilities-Flag, default 0 (
    Bit 0-1 heart rate source (0:invalid)
    Bit 2   Distance valid (0:no, 1=yes)
    Bit 3   Virtual Speed (0: real 1: virtual)
    */
  const feCapabilities=0x40; //heart rate invalid (Bit0-1=0), distance valid (Bit2=1), real speed (Bit3=0)
  const speedMMPerSecond=Math.floor(speed*1000);
  const factor=3.945205479; // m/s -> GarminSpeed


  data.push(0x01);  //Channel
  //---------------------------------------
  data.push(0x10);                                                                           //00: Data page number
  data.push(0x19);                                                                           //01: Equipment Type Bit Field: 25(0x19):Trainer/Stationary Bike
  data = data.concat(Ant.Messages.intToLEHexArray(clock, 1));                                //02: Elapsed Time in 1/4 seconds (rollover 255)
  data = data.concat(Ant.Messages.intToLEHexArray(Math.round(distance)%0x100),1);            //03: Distance traveled in meters (not used by GARMIN)
  //data = data.concat(Ant.Messages.intToLEHexArray(speedMMPerSecond & 0x00FF, 1));          //04: Speed in mm/s LSB ERROR IN DOKU? OR GARMIN?
  //data = data.concat(Ant.Messages.intToLEHexArray((speedMMPerSecond & 0xFF00)>>8, 1));     //05: Speed in mm/s MSB
  data = data.concat(Ant.Messages.intToLEHexArray(Math.round(speed*factor), 1));      //04:Garmin-Speed from Real bike with transmission 32:15 and 28" tire
  data.push(0x00);                                                                           //06: Speed in mm/s MSB
  data.push(0xFF);                                                                           //06: heart reate (invalid)
  data = data.concat(Ant.Messages.intToLEHexArray(this.nibble2Byte(feCapabilities,feState),1));      //07: Capabilities Bit Field, FE State Bit Field
  this.stick.write(Ant.Messages.buildMessage(data, Ant.Constants.MESSAGE_CHANNEL_BROADCAST_DATA));
  //console.log(Date.now(),' 2> ',JSON.stringify(data));  
};

/*
cycleLength [m]
incline       Incline Percentage between -1 and 1
resistance    resistance percentage between 0 (minimum) and 1 maximum
*/
FitnessEquipment.prototype.Page_0X11 = function(cycleLength,incline,resistance,feState) {
  //console.log('Page_0X11(cycleLength=%f, incline=%f, resistance=%f, feState=%d)',cycleLength,incline,resistance,feState);
  var data = [];
  const feCapabilities=0x00; //reserved for fure use
  data.push(0x01);  //Channel
  data.push(0x11);                                                                  //00: Data page number 
  data.push(0xFF);                                                                  //01: reserved
  data.push(0xFF);                                                                  //02: reserved
  data = data.concat(Ant.Messages.intToLEHexArray(Math.floor(cycleLength*100), 1)); //03: Cycle length in cm
  data = data.concat(Ant.Messages.intToLEHexArray(Math.floor(incline*10000), 2));   //04-05: Incline Percentage in 1/100 %
  data = data.concat(Ant.Messages.intToLEHexArray(Math.floor(resistance*200), 1));  //06: Resistance Leve in 0.5%
  data = data.concat(Ant.Messages.intToLEHexArray(this.nibble2Byte(feCapabilities,feState),1));  //07 Capabilities Bit Field, FE State Bit Field
  this.stick.write(Ant.Messages.buildMessage(data, Ant.Constants.MESSAGE_CHANNEL_BROADCAST_DATA));  
  //console.log(Date.now(),' 2> ',JSON.stringify(data));  
};

//Data Page 18 (0x12) – General FE Metabolic Data
FitnessEquipment.prototype.Page_0X12 = function(calBurned,feState) {
  //console.log('Page_0X12(calBurned=%d, feState=%d)',calBurned,feState);
  var data = [];
  const feCapabilities=0x01; //Bit 1=1: The FE will transmitt accumulated Calories in Byte 6
  data.push(0x01);  //Channel
  data.push(0x12);  //00: Data page number 
  data.push(0xFF);  //01: reserved
  data.push(0xFF);  //02: METs LSB
  data.push(0xFF);  //03: METs MSB
  data.push(0xFF);  //04: Instantaneous caloric burn rate LSB
  data.push(0xFF);  //05: Instantaneous caloric burn rate MSB
  data = data.concat(Ant.Messages.intToLEHexArray((Math.floor(calBurned/1000)%0x100, 1)));  //06: accumulated work in kCal (Rollover)
  data = data.concat(Ant.Messages.intToLEHexArray(this.nibble2Byte(feCapabilities,feState),1));  //07 Capabilities Bit Field, FE State Bit Field
  this.stick.write(Ant.Messages.buildMessage(data, Ant.Constants.MESSAGE_CHANNEL_BROADCAST_DATA));
  //console.log(Date.now(),' 2> ',JSON.stringify(data));  
};
//Page 19 (0x13) – Specific Treadmill Data
//Page 20 (0x14) – Specific Elliptical Data
//Page 21 (0x15) – Reserved
//Page 22 (0x16) – Specific Rower Data
//Page 23 (0x17) – Specific Climber Dat
//Page 24 (0x18) – Specific Nordic Skier Data

//Page 25 (0x19) – Specific Trainer/Stationary Bike Data
FitnessEquipment.prototype.Page_0X19 = function(pedal, cadence,power,feState) {
  //console.log('Page_0X19(pedal, cadence=%d, power=%d, feState=%d), power_accumulated=%d',pedal, cadence,power,feState,this.power_accumulated);
  if(!isNaN(cadence) && !isNaN(power) && !isNaN(feState)){    
    const feTrainerStatus=0x00;
    /*
    Trainer Status Bit Field
    Bit 0: Bicycle Power Calibration: 0:Calibration completed / not required, 1: Bicycle power measurement (i.e. Zero Offset) calibration required
    Bit 1: Resistance Calibration 0:Calibration completed / not required, 1: Resistance calibration (i.e. Spint-Down Time) required
    Bit 2: User Configuration: 
    Bit 3: Reserved
    */
    const feFlags=0x00;
    /*
    Trainer Status Bit Field
    Bit 0: Bicycle Power Calibration: 0:Calibration completed / not required, 1: Bicycle power measurement (i.e. Zero Offset) calibration required
    Bit 1: Resistance Calibration 0:Calibration completed / not required, 1: Resistance calibration (i.e. Spint-Down Time) required
    Bit 2: User Configuration: 
    Bit 3: Reserved
    */

    var data = [];

    if(pedal){      
      this.iEventCount=(this.iEventCount+1)%0x100;
      this.power_accumulated = (this.power_accumulated + power)%0x10000;
    }
    
    data.push(0x01);  //Channel
    data.push(0x19);                                                                                  //00: Data page number 
    data = data.concat(Ant.Messages.intToLEHexArray(this.iEventCount,1));                             //01: Event counter increments with each information update  
    data = data.concat(Ant.Messages.intToLEHexArray(cadence,1));                                      //02: Crank cadence
    data = data.concat(Ant.Messages.intToLEHexArray(Math.floor(this.power_accumulated), 2));          //03-04: Accumulated Power MSB, LSB:  [0,65535]W
    data = data.concat(Ant.Messages.intToLEHexArray(Math.floor(power%0x100), 1));                     //05: Instantaneous Power LSB
    //data = data.concat(Ant.Messages.intToLEHexArray(Math.floor(power/0x100)%0x10 + trainerStatus * 0x10,1)); //06: LN: Instantaneous Power LN@MSB, HN: trainerstatus
    data = data.concat(Ant.Messages.intToLEHexArray(this.nibble2Byte(Math.floor(power>>8)%0x10,feTrainerStatus),1)); //06: LN: Instantaneous Power LN@MSB, HN: trainerstatus    
    data = data.concat(Ant.Messages.intToLEHexArray(this.nibble2Byte(feFlags,feState),1));               //07: LSN:Flags Bitfield, MSN: FE State Bit Field        
/*
  console.log('this.iEventCount=',this.iEventCount,
              'cadence=',cadence,
              'Math.floor(this.power_accumulated%0x10000)=',Math.floor(this.power_accumulated%0x10000),
              'Math.floor(power%0x100), 1)=',Math.floor(power%0x100),
              'Math.floor(power/0x100)%0x10 + trainerStatus * 0x10=',Math.floor(power/0x100)%0x10 + trainerStatus * 0x10,
              'feState*0x10+flags=',feState*0x10+flags);
*/              

    this.stick.write(Ant.Messages.buildMessage(data, Ant.Constants.MESSAGE_CHANNEL_BROADCAST_DATA));
    //console.log(Date.now(),' 2> ',JSON.stringify(data));  
  }
};
//Page 26 (0x1A) – Specific Trainer Torque Data


//Page 80 (0x50) Manufacturer’s Identification
FitnessEquipment.prototype.Page_0X50 = function() {
  return;
  console.log('Page_0X50');
};

//Page 80 (0x51)  Product Information
FitnessEquipment.prototype.Page_0X51 = function() {
  return;
  console.log('Page_0X51');
};

module.exports.FitnessEquipment = FitnessEquipment;
